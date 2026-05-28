import {
  LogLevel,
  ObservabilityEvent,
  TelemetryResultStatus,
} from "./generated/contracts";
import type { TelemetryRecord } from "./generated/contracts";

// 与规范文档保持一致的敏感字段集合，统一在 logger 层做兜底脱敏。
const SENSITIVE_KEYS = new Set([
  "token",
  "refresh_token",
  "password",
  "authorization",
  "cookie",
]);

export type TelemetryPayload = Record<string, unknown>;

export interface TelemetryBaseContext {
  trace_id?: string;
  request_id?: string;
  session_id?: string;
  route?: string;
  platform?: string;
  device_id?: string;
  user_uuid?: string;
  role?: string;
  is_authenticated?: boolean;
}

export interface FrontendTelemetryOptions {
  app: "client" | "web";
  appVersion: string;
  env?: string;
  getBaseContext?: () => TelemetryBaseContext;
  sink?: (record: TelemetryRecord) => void | Promise<void>;
}

export interface TrackEventOptions {
  level?: LogLevel;
  payload?: TelemetryPayload;
  latency_ms?: number;
  status?: TelemetryResultStatus;
  error_code?: string;
  error_message?: string;
}

export type TelemetryLevel = "debug" | "info" | "warn" | "error";

const defaultSink = (record: TelemetryRecord) => {
  const line = JSON.stringify(record);
  if (record.level === LogLevel.Error || record.level === LogLevel.Warn) {
    console.warn(line);
  } else {
    console.info(line);
  }
};

export const createTraceId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
};

export const normalizeEventName = (value: string): string => {
  const withDots = value
    .trim()
    .replace(/[:_-]/g, ".")
    .replace(/([a-z0-9])([A-Z])/g, "$1.$2")
    .replace(/\.+/g, ".")
    .replace(/^\./, "")
    .replace(/\.$/, "");
  return withDots.toLowerCase() || "frontend.log.update";
};

const toSerializable = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return "[unserializable]";
  }
};

export const sanitizePayload = (payload: TelemetryPayload = {}) => {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    sanitized[k] = SENSITIVE_KEYS.has(k.toLowerCase())
      ? "***"
      : toSerializable(v);
  }
  return sanitized;
};

const sourceAppName = (app: "client" | "web") =>
  app === "client" ? "navix-client" : "navix-web";

export const createFrontendTelemetryLogger = (
  options: FrontendTelemetryOptions,
) => {
  const sink = options.sink ?? defaultSink;
  const localContext: TelemetryBaseContext = {
    platform: options.app,
  };

  const resolveContext = (overrides: TelemetryBaseContext = {}) => {
    const base = options.getBaseContext?.() ?? {};
    const merged = { ...base, ...localContext, ...overrides };
    if (!merged.trace_id) {
      merged.trace_id = createTraceId();
    }
    if (!merged.session_id) {
      merged.session_id = createTraceId();
    }
    return merged;
  };

  const setContext = (patch: TelemetryBaseContext) => {
    Object.assign(localContext, patch);
  };

  const withTraceHeaders = (
    headers?: HeadersInit,
    overrides: TelemetryBaseContext = {},
  ): Headers => {
    const resolved = resolveContext(overrides);
    const nextHeaders = new Headers(headers);
    const requestId = createTraceId();
    if (!nextHeaders.has("x-trace-id") && resolved.trace_id) {
      nextHeaders.set("x-trace-id", resolved.trace_id);
    }
    if (!nextHeaders.has("x-request-id")) {
      nextHeaders.set("x-request-id", requestId);
    }
    localContext.request_id = requestId;
    return nextHeaders;
  };

  const captureResponseContext = (headers?: Headers | null) => {
    if (!headers) return;
    const traceId = headers.get("x-trace-id");
    if (traceId && traceId.trim().length > 0) {
      localContext.trace_id = traceId.trim();
    }
    const requestId = headers.get("x-request-id");
    if (requestId && requestId.trim().length > 0) {
      localContext.request_id = requestId.trim();
    }
  };

  const track = async (
    event: string,
    optionsOrPayload: TrackEventOptions | TelemetryPayload = {},
    overrides: TelemetryBaseContext = {},
  ) => {
    const isFlatPayload =
      optionsOrPayload !== null &&
      typeof optionsOrPayload === "object" &&
      !("payload" in optionsOrPayload) &&
      !("level" in optionsOrPayload);
    const opts: TrackEventOptions = isFlatPayload
      ? { payload: optionsOrPayload as TelemetryPayload }
      : optionsOrPayload;
    const resolved = resolveContext(overrides);
    const level = opts.level ?? LogLevel.Info;
    const hasFailure =
      level === LogLevel.Error ||
      level === LogLevel.Fatal ||
      !!opts.error_code ||
      !!opts.error_message;
    const record: TelemetryRecord = {
      schema_version: "1.0.0",
      event_name: normalizeEventName(event),
      event_id: createTraceId(),
      timestamp: new Date().toISOString(),
      level,
      source: {
        layer: options.app,
        app: sourceAppName(options.app),
        app_version: options.appVersion,
        env: options.env ?? "local",
      },
      actor: {
        user_uuid: resolved.user_uuid ?? null,
        is_authenticated: resolved.is_authenticated ?? !!resolved.user_uuid,
        role: resolved.role ?? null,
      },
      context: {
        session_id: resolved.session_id ?? createTraceId(),
        trace_id: resolved.trace_id ?? "",
        request_id: resolved.request_id ?? null,
        route: resolved.route ?? null,
        platform: resolved.platform ?? options.app,
        device_id: resolved.device_id ?? null,
      },
      metrics: {
        latency_ms: opts.latency_ms ?? null,
      },
      result: {
        status:
          opts.status ??
          (hasFailure
            ? TelemetryResultStatus.Fail
            : TelemetryResultStatus.Success),
        error_code: opts.error_code ?? null,
        error_message: opts.error_message ?? null,
      },
      payload: sanitizePayload(opts.payload ?? {}),
    };
    await Promise.resolve(sink(record));
    return record;
  };

  const logEvent = async (
    event: ObservabilityEvent,
    level: LogLevel,
    payload: TelemetryPayload = {},
    overrides: TelemetryBaseContext = {},
  ) => track(event, { level, payload }, overrides);

  return {
    track,
    logEvent,
    setContext,
    withTraceHeaders,
    captureResponseContext,
  };
};

const defaultBrowserTelemetry = createFrontendTelemetryLogger({
  app: "web",
  appVersion: "unknown",
});

const levelToContractLevel = (level: TelemetryLevel): LogLevel => {
  if (level === "debug") return LogLevel.Debug;
  if (level === "warn") return LogLevel.Warn;
  if (level === "error") return LogLevel.Error;
  return LogLevel.Info;
};

const parseTelemetryLikeMessage = (
  input: string,
): {
  event: string;
  fields?: Record<string, unknown>;
} => {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      event: "frontend.log.update",
      fields: { message: "" },
    };
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      const event =
        typeof parsed.event === "string" && parsed.event.trim()
          ? parsed.event
          : typeof parsed.event_name === "string" && parsed.event_name.trim()
            ? parsed.event_name
            : "frontend.log.update";
      const { event: _event, event_name: _eventName, ...rest } = parsed;
      return {
        event,
        fields: rest,
      };
    }
  } catch {
    // 非 JSON 字符串按 message 输出。
  }
  return {
    event: "frontend.log.update",
    fields: { message: input },
  };
};

export const logTelemetry = (
  level: TelemetryLevel,
  event: string,
  fields: Record<string, unknown> = {},
) =>
  defaultBrowserTelemetry.track(normalizeEventName(event), {
    level: levelToContractLevel(level),
    payload: fields,
  });

const logRaw = (level: TelemetryLevel, message: string) => {
  const { event, fields } = parseTelemetryLikeMessage(message);
  return logTelemetry(level, event, fields);
};

export const debug = (message: string) => logRaw("debug", message);
export const info = (message: string) => logRaw("info", message);
export const warn = (message: string) => logRaw("warn", message);
export const error = (message: string) => logRaw("error", message);
