//! Navix 统一结构化日志构造工具。
//!
//! 本模块只负责事件名归一化、记录构造与 payload 脱敏；具体输出到
//! `tracing`、`log` 或前端 sink 由各应用侧 adapter 负责。

use crate::dto::telemetry::{
    LogLevel, TelemetryActor, TelemetryContext, TelemetryMetrics, TelemetryRecord, TelemetryResult,
    TelemetryResultStatus, TelemetrySource, TelemetrySourceLayer,
};
use chrono::Utc;
use serde_json::Value;
use std::collections::BTreeMap;
use uuid::Uuid;

const SENSITIVE_KEY_PARTS: [&str; 7] = [
    "token",
    "refresh_token",
    "password",
    "authorization",
    "cookie",
    "secret",
    "api_key",
];

/// 构造结构化日志时需要的应用来源信息。
#[derive(Debug, Clone)]
pub struct TelemetrySourceConfig {
    pub layer: TelemetrySourceLayer,
    pub app: String,
    pub app_version: String,
    pub env: String,
}

/// 构造结构化日志时可选的上下文。
#[derive(Debug, Clone, Default)]
pub struct TelemetryContextConfig {
    pub session_id: Option<String>,
    pub trace_id: Option<String>,
    pub request_id: Option<String>,
    pub route: Option<String>,
    pub platform: Option<String>,
    pub device_id: Option<String>,
}

/// 构造结构化日志时可选的结果信息。
#[derive(Debug, Clone, Default)]
pub struct TelemetryResultConfig {
    pub status: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub latency_ms: Option<u64>,
}

/// 生成无连字符 UUID，便于跨前后端日志检索。
pub fn new_telemetry_id() -> String {
    Uuid::new_v4().as_simple().to_string()
}

/// 读取当前运行环境名称。
pub fn current_env() -> String {
    std::env::var("NAVIX_ENV")
        .or_else(|_| std::env::var("APP_ENV"))
        .unwrap_or_else(|_| "local".to_string())
}

/// 将事件名归一化为小写点分段。
pub fn normalize_event_name(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len() + 4);
    let mut previous_dot = false;
    let mut previous_was_lower_or_digit = false;

    for ch in value.trim().chars() {
        let next = if ch == ':' || ch == '_' || ch == '-' || ch == '.' {
            '.'
        } else {
            ch.to_ascii_lowercase()
        };

        if ch.is_ascii_uppercase() && previous_was_lower_or_digit && !previous_dot {
            normalized.push('.');
        }

        if next == '.' {
            if !previous_dot {
                normalized.push('.');
            }
            previous_dot = true;
            previous_was_lower_or_digit = false;
        } else {
            normalized.push(next);
            previous_dot = false;
            previous_was_lower_or_digit = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        }
    }

    let trimmed = normalized.trim_matches('.');
    if trimmed.is_empty() {
        "runtime.log.update".to_string()
    } else {
        trimmed.to_string()
    }
}

/// 构造 JSON payload，自动脱敏敏感键。
pub fn json_payload(entries: impl IntoIterator<Item = (String, Value)>) -> BTreeMap<String, Value> {
    sanitize_payload(entries.into_iter().collect())
}

/// 构造字符串 payload，自动脱敏敏感键。
pub fn string_payload(
    entries: impl IntoIterator<Item = (String, String)>,
) -> BTreeMap<String, Value> {
    sanitize_payload(
        entries
            .into_iter()
            .map(|(key, value)| (key, Value::String(value)))
            .collect(),
    )
}

/// 对 payload 做兜底脱敏。
pub fn sanitize_payload(payload: BTreeMap<String, Value>) -> BTreeMap<String, Value> {
    payload
        .into_iter()
        .map(|(key, value)| {
            let sanitized = sanitize_value_by_key(&key, value);
            (key, sanitized)
        })
        .collect()
}

/// 构造统一结构化日志记录。
pub fn build_telemetry_record(
    event_name: &str,
    level: LogLevel,
    source: TelemetrySourceConfig,
    context: TelemetryContextConfig,
    result: TelemetryResultConfig,
    payload: Option<BTreeMap<String, Value>>,
) -> TelemetryRecord {
    let trace_id = non_empty_or_new(context.trace_id);
    let session_id = non_empty_or(context.session_id, &trace_id);
    let has_failure = matches!(level, LogLevel::Warn | LogLevel::Error | LogLevel::Fatal);
    let result_status = result.status.unwrap_or_else(|| {
        if has_failure {
            TelemetryResultStatus::Fail.as_str().to_string()
        } else {
            TelemetryResultStatus::Success.as_str().to_string()
        }
    });

    TelemetryRecord {
        schema_version: "1.0.0".to_string(),
        event_name: normalize_event_name(event_name),
        event_id: new_telemetry_id(),
        timestamp: Utc::now().to_rfc3339(),
        level: level.as_str().to_string(),
        source: TelemetrySource {
            layer: source.layer.as_str().to_string(),
            app: source.app,
            app_version: source.app_version,
            env: source.env,
        },
        actor: TelemetryActor {
            user_uuid: None,
            is_authenticated: false,
            role: None,
        },
        context: TelemetryContext {
            session_id,
            trace_id,
            request_id: context.request_id.filter(|value| !value.trim().is_empty()),
            route: context.route,
            platform: context.platform,
            device_id: context.device_id,
        },
        metrics: TelemetryMetrics {
            latency_ms: result.latency_ms,
        },
        result: TelemetryResult {
            status: result_status,
            error_code: result.error_code,
            error_message: result.error_message,
        },
        payload: payload.map(sanitize_payload),
    }
}

/// 序列化结构化日志记录，输出前再次做 payload 脱敏。
pub fn serialize_telemetry_record(mut record: TelemetryRecord) -> serde_json::Result<String> {
    record.event_name = normalize_event_name(&record.event_name);
    record.payload = record.payload.map(sanitize_payload);
    serde_json::to_string(&record)
}

fn non_empty_or_new(value: Option<String>) -> String {
    value
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(new_telemetry_id)
}

fn non_empty_or(value: Option<String>, fallback: &str) -> String {
    value
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn is_sensitive_key(key: &str) -> bool {
    let lowered = key.to_ascii_lowercase();
    SENSITIVE_KEY_PARTS
        .iter()
        .any(|sensitive| lowered == *sensitive || lowered.contains(sensitive))
}

fn sanitize_value_by_key(key: &str, value: Value) -> Value {
    if is_sensitive_key(key) {
        return Value::String("***".to_string());
    }

    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(nested_key, nested_value)| {
                    let sanitized = sanitize_value_by_key(&nested_key, nested_value);
                    (nested_key, sanitized)
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .map(|value| sanitize_value_by_key(key, value))
                .collect(),
        ),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn source() -> TelemetrySourceConfig {
        TelemetrySourceConfig {
            layer: TelemetrySourceLayer::Server,
            app: "navix-server".to_string(),
            app_version: "0.0.0".to_string(),
            env: "test".to_string(),
        }
    }

    #[test]
    fn normalizes_event_name_to_dot_segments() {
        assert_eq!(
            normalize_event_name("auth.token_verify.started"),
            "auth.token.verify.started"
        );
        assert_eq!(
            normalize_event_name("sync.compat-check.passed"),
            "sync.compat.check.passed"
        );
        assert_eq!(
            normalize_event_name("proxy.closeAll.start"),
            "proxy.close.all.start"
        );
        assert_eq!(normalize_event_name("..."), "runtime.log.update");
    }

    #[test]
    fn sanitizes_sensitive_payload_keys_recursively() {
        let payload = json_payload([(
            "outer".to_string(),
            json!({ "accessToken": "abc", "safe": "value" }),
        )]);
        assert_eq!(payload["outer"]["accessToken"], json!("***"));
        assert_eq!(payload["outer"]["safe"], json!("value"));
    }

    #[test]
    fn preserves_trace_id_and_marks_failures() {
        let record = build_telemetry_record(
            "auth.login.failed",
            LogLevel::Warn,
            source(),
            TelemetryContextConfig {
                trace_id: Some("trace-1".to_string()),
                ..Default::default()
            },
            TelemetryResultConfig::default(),
            None,
        );
        assert_eq!(record.context.trace_id, "trace-1");
        assert_eq!(record.context.session_id, "trace-1");
        assert_eq!(record.result.status, "fail");
    }
}
