/**
 * Web 端统一请求层。
 *
 * 当前登录态采用 access token + refresh token 双令牌策略：
 * - 页面请求正常携带 access token 访问受保护接口
 * - 当接口返回 token 失效或过期时，请求层会自动调用 `/api/refresh`
 * - refresh 成功后立即写回新的 access token / refresh token，并自动重放原请求
 * - refresh 失败时清理本地会话，由页面层按既有逻辑跳转到登录页
 *
 * 为避免并发请求同时触发多次 refresh，这里使用模块级共享 Promise 合并刷新流程。
 * 因此当前实现的目标是：用户在 refresh token 仍有效时，access token 过期应尽量无感恢复。
 */
import { APP_ERROR_CODES } from "@navix/shared-ts";
import type { ApiResponse } from "@navix/shared-ts";
import {
  AppException,
  appExceptionFromResponse,
  createAppException,
  createFrontendTelemetryLogger,
  isAuthAppError,
} from "@navix/shared-ts";
import {
  clearInvalidUserSession,
  getUserRefreshToken,
  setCurrentUserSession,
} from "../auth/tokenStore";

const telemetry = createFrontendTelemetryLogger({
  app: "web",
  appVersion:
    (import.meta as { env?: { VITE_APP_VERSION?: string } }).env
      ?.VITE_APP_VERSION ?? "unknown",
});

export { AppException as ApiRequestError };

type DecodedResponse = {
  response: Response;
  payload: unknown;
};

type RequestExecutionOptions = {
  retried?: boolean;
};

let refreshPromise: Promise<string | null> | null = null;

function isApiEnvelope<T = unknown>(value: unknown): value is ApiResponse<T> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.success === "boolean" &&
    typeof record.code === "string" &&
    typeof record.http_status === "number" &&
    typeof record.message === "string"
  );
}

function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.length > 0) {
    return record.message;
  }
  if (typeof record.error === "string" && record.error.length > 0) {
    return record.error;
  }
  return "";
}

function buildHeaders(headers?: HeadersInit): Headers {
  return new Headers(headers);
}

function isAuthRefreshEndpoint(url: string): boolean {
  return url === "/api/refresh";
}

function getBearerToken(headers: Headers): string | null {
  const authorization = headers.get("Authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ", 2);
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

function shouldAttemptRefresh(
  url: string,
  response: Response,
  payload: unknown,
  headers: Headers,
  retried: boolean,
): boolean {
  if (retried || isAuthRefreshEndpoint(url)) {
    return false;
  }

  if (!getBearerToken(headers)) {
    return false;
  }

  if (isApiEnvelope(payload)) {
    return (
      payload.code === APP_ERROR_CODES.AuthTokenExpired ||
      payload.code === APP_ERROR_CODES.AuthTokenInvalid
    );
  }

  return response.status === 401;
}

/**
 * 解析 HTTP 响应体，统一提取 JSON 载荷供错误处理和续签判断复用。
 */
async function decodeResponse(response: Response): Promise<DecodedResponse> {
  const contentType = response.headers.get("content-type") || "";
  const payload: unknown = contentType.includes("application/json")
    ? ((await response.json()) as unknown)
    : null;

  return { response, payload };
}

/**
 * 执行原始请求响应链。
 *
 * 当带鉴权头的请求命中 token 失效场景时，先尝试刷新 access token，
 * 再用新的 token 重放一次原请求；二次失败则直接返回失败响应。
 */
async function executeResponse(
  url: string,
  options?: RequestInit,
  execution: RequestExecutionOptions = {},
): Promise<Response> {
  const headers = buildHeaders(telemetry.withTraceHeaders(options?.headers));
  const response = await fetch(url, { ...options, headers });

  if (
    shouldAttemptRefresh(
      url,
      response,
      await decodeResponse(response.clone()).then((decoded) => decoded.payload),
      headers,
      execution.retried ?? false,
    )
  ) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      headers.set("Authorization", `Bearer ${refreshedToken}`);
      return executeResponse(
        url,
        { ...options, headers },
        { ...execution, retried: true },
      );
    }
  }

  telemetry.captureResponseContext(response.headers);
  return response;
}

/**
 * 执行 JSON 请求并返回已解码的响应体。
 */
async function executeRequest(
  url: string,
  options: RequestInit | undefined,
  execution: RequestExecutionOptions,
): Promise<DecodedResponse> {
  return decodeResponse(await executeResponse(url, options, execution));
}

/**
 * 使用本地 refresh token 换取新的 access token。
 *
 * 该流程带并发合并能力，同一时刻多个请求只会共享一次 refresh。
 * 若刷新失败，则清理本地会话，由页面层按既有逻辑回到登录页。
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const refreshToken = getUserRefreshToken();
    if (!refreshToken) {
      clearInvalidUserSession();
      return null;
    }

    const headers = buildHeaders(
      telemetry.withTraceHeaders({ "Content-Type": "application/json" }),
    );
    const response = await fetch("/api/refresh", {
      method: "POST",
      headers,
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    telemetry.captureResponseContext(response.headers);
    const decoded = await decodeResponse(response);

    if (!decoded.response.ok) {
      clearInvalidUserSession();
      return null;
    }

    const payload = decoded.payload as Record<string, unknown> | null;
    const accessToken =
      typeof payload?.access_token === "string" ? payload.access_token : null;
    const nextRefreshToken =
      typeof payload?.refresh_token === "string" ? payload.refresh_token : null;

    if (!accessToken || !nextRefreshToken) {
      clearInvalidUserSession();
      return null;
    }

    setCurrentUserSession(accessToken, nextRefreshToken);
    return accessToken;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function throwApiError(
  response: Response,
  payload: unknown,
  expectEnvelope: boolean,
): never {
  if (expectEnvelope && !isApiEnvelope(payload)) {
    throw createAppException({
      source: response.ok ? "http" : "server",
      code: APP_ERROR_CODES.RequestBadRequest,
      message: extractErrorMessage(payload) || "响应格式不符合约定",
      httpStatus: response.status,
      cause: payload,
    });
  }

  if (expectEnvelope) {
    const envelope = payload as ApiResponse<unknown>;
    throw appExceptionFromResponse(envelope, "server", {
      code: APP_ERROR_CODES.RequestBadRequest,
      message: envelope.message || "请求失败",
      httpStatus: envelope.http_status || response.status,
    });
  }

  throw appExceptionFromResponse(payload, "server", {
    code: APP_ERROR_CODES.RequestBadRequest,
    message: extractErrorMessage(payload) || "请求失败",
    httpStatus: response.status,
  });
}

/**
 * 统一调用返回 ApiResponse 信封的后端接口。
 */
export async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<ApiResponse<T>> {
  const { response, payload } = await executeRequest(url, options, {});

  if (!isApiEnvelope<T>(payload)) {
    throwApiError(response, payload, true);
  }

  if (!response.ok || !payload.success) {
    throwApiError(response, payload, true);
  }

  return payload;
}

/**
 * 调用返回非 ApiResponse 信封的接口（如 /api/login）。
 */
export async function apiFetchRaw<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const { response, payload } = await executeRequest(url, options, {});

  if (!response.ok) {
    throwApiError(response, payload, false);
  }

  return payload as T;
}

/**
 * 调用返回二进制或非 JSON 业务数据的接口，同时复用统一的自动续签逻辑。
 */
export async function apiFetchResponse(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  return executeResponse(url, options);
}

export function isAuthError(err: unknown): err is AppException {
  return isAuthAppError(err);
}
