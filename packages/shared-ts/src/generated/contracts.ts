import { z } from "zod";

export const AppErrorCategory = {
  Auth: "auth",
  User: "user",
  Sync: "sync",
  Permission: "permission",
  Validation: "validation",
  Request: "request",
  NotFound: "not_found",
  Network: "network",
  Timeout: "timeout",
  Internal: "internal",
  Client: "client",
} as const;
export const appErrorCategorySchema = z.enum(
  Object.values(AppErrorCategory) as [string, ...string[]],
);
export type AppErrorCategory = z.infer<typeof appErrorCategorySchema>;

export const APP_ERROR_CODES = {
  AuthWrongCredentials: "AUTH.WRONG_CREDENTIALS",
  AuthUserNotFound: "AUTH.USER_NOT_FOUND",
  AuthUserDisabled: "AUTH.USER_DISABLED",
  AuthUserDeleted: "AUTH.USER_DELETED",
  AuthMissingCredentials: "AUTH.MISSING_CREDENTIALS",
  AuthTokenInvalid: "AUTH.TOKEN_INVALID",
  AuthTokenExpired: "AUTH.TOKEN_EXPIRED",
  AuthTokenCreationFailed: "AUTH.TOKEN_CREATION_FAILED",
  UserUsernameExists: "USER.USERNAME_EXISTS",
  UserWrongOldPassword: "USER.WRONG_OLD_PASSWORD",
  UserInvalidPassword: "USER.INVALID_PASSWORD",
  SyncClientVersionMismatch: "SYNC.CLIENT_VERSION_MISMATCH",
  SyncProtocolMismatch: "SYNC.PROTOCOL_MISMATCH",
  SyncSessionInvalid: "SYNC.SESSION_INVALID",
  ResourceForbidden: "RESOURCE.FORBIDDEN",
  ResourceNotFound: "RESOURCE.NOT_FOUND",
  RequestBadRequest: "REQUEST.BAD_REQUEST",
  RequestValidationFailed: "REQUEST.VALIDATION_FAILED",
  InternalServerError: "INTERNAL.SERVER_ERROR",
  InternalDbError: "INTERNAL.DB_ERROR",
  InternalIoError: "INTERNAL.IO_ERROR",
  NetworkRequestFailed: "NETWORK.REQUEST_FAILED",
  RequestTimeout: "REQUEST.TIMEOUT",
  TauriInvokeFailed: "TAURI.INVOKE_FAILED",
  ClientUnexpectedError: "CLIENT.UNEXPECTED_ERROR",
} as const;
export type AppErrorCode =
  (typeof APP_ERROR_CODES)[keyof typeof APP_ERROR_CODES];
export const appErrorCodeSchema = z.enum(
  Object.values(APP_ERROR_CODES) as [string, ...string[]],
);

export const DataType = {
  WebsiteGroups: "WebsiteGroups",
  Websites: "Websites",
  SearchEngines: "SearchEngines",
  LocalIcons: "LocalIcons",
} as const;
export const dataTypeSchema = z.enum(
  Object.values(DataType) as [string, ...string[]],
);
export type DataType = z.infer<typeof dataTypeSchema>;

export const LogLevel = {
  Debug: "DEBUG",
  Info: "INFO",
  Warn: "WARN",
  Error: "ERROR",
  Fatal: "FATAL",
} as const;
export const logLevelSchema = z.enum(
  Object.values(LogLevel) as [string, ...string[]],
);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const ObservabilityEvent = {
  ApiRequestCompleted: "api.request.completed",
  AuthLoginStarted: "auth.login.started",
  AuthLoginSucceeded: "auth.login.succeeded",
  AuthLoginFailed: "auth.login.failed",
  AuthRefreshStarted: "auth.refresh.started",
  AuthRefreshSucceeded: "auth.refresh.succeeded",
  AuthRefreshFailed: "auth.refresh.failed",
  AuthTokenVerifyStarted: "auth.token.verify.started",
  AuthTokenVerifySucceeded: "auth.token.verify.succeeded",
  AuthTokenVerifyFailed: "auth.token.verify.failed",
  SyncCompatCheckStarted: "sync.compat.check.started",
  SyncCompatCheckPassed: "sync.compat.check.passed",
  SyncCompatCheckBlocked: "sync.compat.check.blocked",
  SyncSessionStarted: "sync.session.started",
  SyncSessionAcknowledged: "sync.session.acknowledged",
  SyncSessionCompleted: "sync.session.completed",
  SyncSessionFailed: "sync.session.failed",
  SyncChunkSent: "sync.chunk.sent",
  SyncChunkReceived: "sync.chunk.received",
} as const;
export const observabilityEventSchema = z.enum(
  Object.values(ObservabilityEvent) as [string, ...string[]],
);
export type ObservabilityEvent = z.infer<typeof observabilityEventSchema>;

export const TelemetryResultStatus = {
  Success: "success",
  Fail: "fail",
  Timeout: "timeout",
  Canceled: "canceled",
} as const;
export const telemetryResultStatusSchema = z.enum(
  Object.values(TelemetryResultStatus) as [string, ...string[]],
);
export type TelemetryResultStatus = z.infer<typeof telemetryResultStatusSchema>;

export const TelemetrySourceLayer = {
  Web: "web",
  Client: "client",
  Server: "server",
  SharedRs: "shared-rs",
} as const;
export const telemetrySourceLayerSchema = z.enum(
  Object.values(TelemetrySourceLayer) as [string, ...string[]],
);
export type TelemetrySourceLayer = z.infer<typeof telemetrySourceLayerSchema>;

export interface ApiResponse<T> {
  success: boolean;
  code: string;
  http_status: number;
  message: string;
  data: T | null;
  details: Record<string, string[]> | null;
  trace_id: string | null;
  error: AppErrorPayload | null;
}
export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    code: z.string(),
    http_status: z.number(),
    message: z.string(),
    data: dataSchema.nullable().optional(),
    details: z.record(z.string(), z.array(z.string())).nullable().optional(),
    trace_id: z.string().nullable().optional(),
    error: z
      .lazy(() => appErrorPayloadSchema)
      .nullable()
      .optional(),
  });

export interface AppErrorPayload {
  code: AppErrorCode;
  message: string;
  category: AppErrorCategory;
  retryable: boolean;
  http_status: number;
  details: Record<string, string[]> | null;
  trace_id: string | null;
}
export const appErrorPayloadSchema = z.object({
  code: appErrorCodeSchema,
  message: z.string(),
  category: appErrorCategorySchema,
  retryable: z.boolean(),
  http_status: z.number(),
  details: z.record(z.string(), z.array(z.string())).nullable().optional(),
  trace_id: z.string().nullable().optional(),
});
export type AppErrorPayloadDto = z.infer<typeof appErrorPayloadSchema>;

export interface ChangePasswordPayload {
  old_password: string;
  new_password: string;
}
export const changePasswordPayloadSchema = z.object({
  old_password: z.string(),
  new_password: z.string(),
});
export type ChangePasswordPayloadDto = z.infer<
  typeof changePasswordPayloadSchema
>;

export interface Claims {
  sub: string;
  exp: number;
  iss: string;
  username: string;
  roles: string[];
}
export const claimsSchema = z.object({
  sub: z.string(),
  exp: z.number(),
  iss: z.string(),
  username: z.string(),
  roles: z.array(z.string()),
});
export type ClaimsDto = z.infer<typeof claimsSchema>;

export interface ClientCompatibilityRequest {
  app_version: string;
  sync_protocol: number;
}
export const clientCompatibilityRequestSchema = z.object({
  app_version: z.string(),
  sync_protocol: z.number(),
});
export type ClientCompatibilityRequestDto = z.infer<
  typeof clientCompatibilityRequestSchema
>;

export interface ClientInfoDto {
  app_version: string;
  username: string;
  token: string;
  server_address: string;
}
export const clientInfoDtoSchema = z.object({
  app_version: z.string(),
  username: z.string(),
  token: z.string(),
  server_address: z.string(),
});
export type ClientInfoDtoDto = z.infer<typeof clientInfoDtoSchema>;

export interface ClientSyncData {
  user_uuid: string;
  last_synced_rev: number;
  sync_data: SyncDataDto;
  local_icons: string[];
}
export const clientSyncDataSchema = z.object({
  user_uuid: z.string(),
  last_synced_rev: z.number(),
  sync_data: z.lazy(() => syncDataDtoSchema),
  local_icons: z.array(z.string()),
});
export type ClientSyncDataDto = z.infer<typeof clientSyncDataSchema>;

export interface ClientSyncDataChunk {
  session_id: string;
  data_type: DataType;
  chunk_index: number;
  total_chunks: number;
  chunk_checksum: string;
  chunk_data: unknown;
}
export const clientSyncDataChunkSchema = z.object({
  session_id: z.string(),
  data_type: dataTypeSchema,
  chunk_index: z.number(),
  total_chunks: z.number(),
  chunk_checksum: z.string(),
  chunk_data: z.unknown(),
});
export type ClientSyncDataChunkDto = z.infer<typeof clientSyncDataChunkSchema>;

export interface ClientSyncPayload {
  user_uuid: string;
  last_synced_rev: number;
}
export const clientSyncPayloadSchema = z.object({
  user_uuid: z.string(),
  last_synced_rev: z.number(),
});
export type ClientSyncPayloadDto = z.infer<typeof clientSyncPayloadSchema>;

export interface CompatibilityInfo {
  server_version: string;
  min_client_version: string;
  recommended_client_version: string;
  sync_protocol_current: number;
  sync_protocol_min_client: number;
}
export const compatibilityInfoSchema = z.object({
  server_version: z.string(),
  min_client_version: z.string(),
  recommended_client_version: z.string(),
  sync_protocol_current: z.number(),
  sync_protocol_min_client: z.number(),
});
export type CompatibilityInfoDto = z.infer<typeof compatibilityInfoSchema>;

export interface CompleteSyncPayload {
  session_id: string;
}
export const completeSyncPayloadSchema = z.object({
  session_id: z.string(),
});
export type CompleteSyncPayloadDto = z.infer<typeof completeSyncPayloadSchema>;

export interface CreateUserPayload {
  username: string;
  password: string;
}
export const createUserPayloadSchema = z.object({
  username: z.string(),
  password: z.string(),
});
export type CreateUserPayloadDto = z.infer<typeof createUserPayloadSchema>;

export interface CurrentUserPayload {
  username: string;
  uuid: string;
  role: string;
  disabled_at: string | null;
  deleted_at: string | null;
}
export const currentUserPayloadSchema = z.object({
  username: z.string(),
  uuid: z.string(),
  role: z.string(),
  disabled_at: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
});
export type CurrentUserPayloadDto = z.infer<typeof currentUserPayloadSchema>;

export interface LoginRequest {
  username: string;
  password: string;
}
export const loginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
});
export type LoginRequestDto = z.infer<typeof loginRequestSchema>;

export interface LoginResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
}
export const loginResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  refresh_token: z.string(),
});
export type LoginResponseDto = z.infer<typeof loginResponseSchema>;

export interface RefreshRequest {
  refresh_token: string;
}
export const refreshRequestSchema = z.object({
  refresh_token: z.string(),
});
export type RefreshRequestDto = z.infer<typeof refreshRequestSchema>;

export interface SearchEngineDto {
  uuid: string;
  name: string;
  url_template: string;
  default_icon: string | null;
  local_icon_path: string | null;
  is_default: number;
  sort_order: number | null;
  is_deleted: number;
  rev: number;
  updated_at: string;
}
export const searchEngineDtoSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  url_template: z.string(),
  default_icon: z.string().nullable().optional(),
  local_icon_path: z.string().nullable().optional(),
  is_default: z.number(),
  sort_order: z.number().nullable().optional(),
  is_deleted: z.number(),
  rev: z.number(),
  updated_at: z.string(),
});
export type SearchEngineDtoDto = z.infer<typeof searchEngineDtoSchema>;

export interface ServerSyncData {
  current_synced_rev: number;
  current_synced_at: string;
  sync_data: SyncDataDto;
  icons_to_upload: string[];
  icons_to_download: string[];
  website_groups_count: number;
  websites_count: number;
  search_engines_count: number;
}
export const serverSyncDataSchema = z.object({
  current_synced_rev: z.number(),
  current_synced_at: z.string(),
  sync_data: z.lazy(() => syncDataDtoSchema),
  icons_to_upload: z.array(z.string()),
  icons_to_download: z.array(z.string()),
  website_groups_count: z.number(),
  websites_count: z.number(),
  search_engines_count: z.number(),
});
export type ServerSyncDataDto = z.infer<typeof serverSyncDataSchema>;

export interface StartSyncResponse {
  session_id: string;
  server_instance_uuid: string;
  suggested_chunk_size: number | null;
}
export const startSyncResponseSchema = z.object({
  session_id: z.string(),
  server_instance_uuid: z.string(),
  suggested_chunk_size: z.number().nullable().optional(),
});
export type StartSyncResponseDto = z.infer<typeof startSyncResponseSchema>;

export interface SyncDataDto {
  website_groups: WebsiteGroupDto[];
  websites: WebsitesDto[];
  search_engines: SearchEngineDto[];
}
export const syncDataDtoSchema = z.object({
  website_groups: z.array(z.lazy(() => websiteGroupDtoSchema)),
  websites: z.array(z.lazy(() => websitesDtoSchema)),
  search_engines: z.array(z.lazy(() => searchEngineDtoSchema)),
});
export type SyncDataDtoDto = z.infer<typeof syncDataDtoSchema>;

export interface TelemetryActor {
  user_uuid: string | null;
  is_authenticated: boolean;
  role: string | null;
}
export const telemetryActorSchema = z.object({
  user_uuid: z.string().nullable().optional(),
  is_authenticated: z.boolean(),
  role: z.string().nullable().optional(),
});
export type TelemetryActorDto = z.infer<typeof telemetryActorSchema>;

export interface TelemetryContext {
  session_id: string;
  trace_id: string;
  request_id: string | null;
  route: string | null;
  platform: string | null;
  device_id: string | null;
}
export const telemetryContextSchema = z.object({
  session_id: z.string(),
  trace_id: z.string(),
  request_id: z.string().nullable().optional(),
  route: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  device_id: z.string().nullable().optional(),
});
export type TelemetryContextDto = z.infer<typeof telemetryContextSchema>;

export interface TelemetryMetrics {
  latency_ms: number | null;
}
export const telemetryMetricsSchema = z.object({
  latency_ms: z.number().nullable().optional(),
});
export type TelemetryMetricsDto = z.infer<typeof telemetryMetricsSchema>;

export interface TelemetryRecord {
  schema_version: string;
  event_name: string;
  event_id: string;
  timestamp: string;
  level: string;
  source: TelemetrySource;
  actor: TelemetryActor;
  context: TelemetryContext;
  metrics: TelemetryMetrics;
  result: TelemetryResult;
  payload: Record<string, unknown> | null;
}
export const telemetryRecordSchema = z.object({
  schema_version: z.string(),
  event_name: z.string(),
  event_id: z.string(),
  timestamp: z.string(),
  level: z.string(),
  source: z.lazy(() => telemetrySourceSchema),
  actor: z.lazy(() => telemetryActorSchema),
  context: z.lazy(() => telemetryContextSchema),
  metrics: z.lazy(() => telemetryMetricsSchema),
  result: z.lazy(() => telemetryResultSchema),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type TelemetryRecordDto = z.infer<typeof telemetryRecordSchema>;

export interface TelemetryResult {
  status: string;
  error_code: string | null;
  error_message: string | null;
}
export const telemetryResultSchema = z.object({
  status: z.string(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
});
export type TelemetryResultDto = z.infer<typeof telemetryResultSchema>;

export interface TelemetrySource {
  layer: string;
  app: string;
  app_version: string;
  env: string;
}
export const telemetrySourceSchema = z.object({
  layer: z.string(),
  app: z.string(),
  app_version: z.string(),
  env: z.string(),
});
export type TelemetrySourceDto = z.infer<typeof telemetrySourceSchema>;

export interface UpdateUsernamePayload {
  new_username: string;
}
export const updateUsernamePayloadSchema = z.object({
  new_username: z.string(),
});
export type UpdateUsernamePayloadDto = z.infer<
  typeof updateUsernamePayloadSchema
>;

export interface VersionInfo {
  version: string;
  commit_hash: string;
  build_time: string;
  build_env: string;
}
export const versionInfoSchema = z.object({
  version: z.string(),
  commit_hash: z.string(),
  build_time: z.string(),
  build_env: z.string(),
});
export type VersionInfoDto = z.infer<typeof versionInfoSchema>;

export interface WebsiteGroupDto {
  uuid: string;
  name: string;
  description: string | null;
  sort_order: number | null;
  is_deleted: number;
  rev: number;
  updated_at: string;
}
export const websiteGroupDtoSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  is_deleted: z.number(),
  rev: z.number(),
  updated_at: z.string(),
});
export type WebsiteGroupDtoDto = z.infer<typeof websiteGroupDtoSchema>;

export interface WebsitesDto {
  uuid: string;
  group_uuid: string;
  title: string;
  url: string;
  url_lan: string | null;
  default_icon: string | null;
  local_icon_path: string | null;
  background_color: string | null;
  description: string | null;
  sort_order: number | null;
  is_deleted: number;
  rev: number;
  updated_at: string;
}
export const websitesDtoSchema = z.object({
  uuid: z.string(),
  group_uuid: z.string(),
  title: z.string(),
  url: z.string(),
  url_lan: z.string().nullable().optional(),
  default_icon: z.string().nullable().optional(),
  local_icon_path: z.string().nullable().optional(),
  background_color: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  is_deleted: z.number(),
  rev: z.number(),
  updated_at: z.string(),
});
export type WebsitesDtoDto = z.infer<typeof websitesDtoSchema>;

export function isErrorCode(code: string, target: AppErrorCode): boolean {
  return code === target;
}
