use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// 全链路统一事件名；server/client/web 必须复用该枚举，避免字符串漂移。
#[derive(Debug, Serialize, Deserialize, Clone, Copy, Eq, PartialEq, Hash)]
pub enum ObservabilityEvent {
    #[serde(rename = "api.request.completed")]
    ApiRequestCompleted,
    #[serde(rename = "auth.login.started")]
    AuthLoginStarted,
    #[serde(rename = "auth.login.succeeded")]
    AuthLoginSucceeded,
    #[serde(rename = "auth.login.failed")]
    AuthLoginFailed,
    #[serde(rename = "auth.refresh.started")]
    AuthRefreshStarted,
    #[serde(rename = "auth.refresh.succeeded")]
    AuthRefreshSucceeded,
    #[serde(rename = "auth.refresh.failed")]
    AuthRefreshFailed,
    #[serde(rename = "auth.token.verify.started")]
    AuthTokenVerifyStarted,
    #[serde(rename = "auth.token.verify.succeeded")]
    AuthTokenVerifySucceeded,
    #[serde(rename = "auth.token.verify.failed")]
    AuthTokenVerifyFailed,
    #[serde(rename = "sync.compat.check.started")]
    SyncCompatCheckStarted,
    #[serde(rename = "sync.compat.check.passed")]
    SyncCompatCheckPassed,
    #[serde(rename = "sync.compat.check.blocked")]
    SyncCompatCheckBlocked,
    #[serde(rename = "sync.session.started")]
    SyncSessionStarted,
    #[serde(rename = "sync.session.acknowledged")]
    SyncSessionAcknowledged,
    #[serde(rename = "sync.session.completed")]
    SyncSessionCompleted,
    #[serde(rename = "sync.session.failed")]
    SyncSessionFailed,
    #[serde(rename = "sync.chunk.sent")]
    SyncChunkSent,
    #[serde(rename = "sync.chunk.received")]
    SyncChunkReceived,
}

impl ObservabilityEvent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ApiRequestCompleted => "api.request.completed",
            Self::AuthLoginStarted => "auth.login.started",
            Self::AuthLoginSucceeded => "auth.login.succeeded",
            Self::AuthLoginFailed => "auth.login.failed",
            Self::AuthRefreshStarted => "auth.refresh.started",
            Self::AuthRefreshSucceeded => "auth.refresh.succeeded",
            Self::AuthRefreshFailed => "auth.refresh.failed",
            Self::AuthTokenVerifyStarted => "auth.token.verify.started",
            Self::AuthTokenVerifySucceeded => "auth.token.verify.succeeded",
            Self::AuthTokenVerifyFailed => "auth.token.verify.failed",
            Self::SyncCompatCheckStarted => "sync.compat.check.started",
            Self::SyncCompatCheckPassed => "sync.compat.check.passed",
            Self::SyncCompatCheckBlocked => "sync.compat.check.blocked",
            Self::SyncSessionStarted => "sync.session.started",
            Self::SyncSessionAcknowledged => "sync.session.acknowledged",
            Self::SyncSessionCompleted => "sync.session.completed",
            Self::SyncSessionFailed => "sync.session.failed",
            Self::SyncChunkSent => "sync.chunk.sent",
            Self::SyncChunkReceived => "sync.chunk.received",
        }
    }
}

/// 统一日志等级模型。
#[derive(Debug, Serialize, Deserialize, Clone, Copy, Eq, PartialEq, Hash)]
pub enum LogLevel {
    #[serde(rename = "DEBUG")]
    Debug,
    #[serde(rename = "INFO")]
    Info,
    #[serde(rename = "WARN")]
    Warn,
    #[serde(rename = "ERROR")]
    Error,
    #[serde(rename = "FATAL")]
    Fatal,
}

impl LogLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Debug => "DEBUG",
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
            Self::Fatal => "FATAL",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, Eq, PartialEq, Hash)]
pub enum TelemetrySourceLayer {
    #[serde(rename = "web")]
    Web,
    #[serde(rename = "client")]
    Client,
    #[serde(rename = "server")]
    Server,
    #[serde(rename = "shared-rs")]
    SharedRs,
}

impl TelemetrySourceLayer {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Web => "web",
            Self::Client => "client",
            Self::Server => "server",
            Self::SharedRs => "shared-rs",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, Eq, PartialEq, Hash)]
pub enum TelemetryResultStatus {
    #[serde(rename = "success")]
    Success,
    #[serde(rename = "fail")]
    Fail,
    #[serde(rename = "timeout")]
    Timeout,
    #[serde(rename = "canceled")]
    Canceled,
}

impl TelemetryResultStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Fail => "fail",
            Self::Timeout => "timeout",
            Self::Canceled => "canceled",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TelemetrySource {
    pub layer: String,
    pub app: String,
    pub app_version: String,
    pub env: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TelemetryActor {
    pub user_uuid: Option<String>,
    pub is_authenticated: bool,
    pub role: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TelemetryContext {
    pub session_id: String,
    pub trace_id: String,
    pub request_id: Option<String>,
    pub route: Option<String>,
    pub platform: Option<String>,
    pub device_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TelemetryMetrics {
    pub latency_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TelemetryResult {
    pub status: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

/// 统一埋点记录结构（规范模型），运行时由各 app 侧 adapter 填充与输出。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TelemetryRecord {
    pub schema_version: String,
    pub event_name: String,
    pub event_id: String,
    pub timestamp: String,
    pub level: String,
    pub source: TelemetrySource,
    pub actor: TelemetryActor,
    pub context: TelemetryContext,
    pub metrics: TelemetryMetrics,
    pub result: TelemetryResult,
    pub payload: Option<BTreeMap<String, Value>>,
}
