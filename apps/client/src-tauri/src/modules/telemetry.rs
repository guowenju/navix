//! Tauri 宿主侧结构化日志 adapter。
//!
//! `logger` 模块只初始化日志 sink，本模块负责构造统一 telemetry 记录并路由到
//! `log` 宏，保证客户端 Rust 日志与 server / TS 共用同一 schema。

use shared_rs::dto::telemetry::{LogLevel, TelemetrySourceLayer};
use shared_rs::telemetry::{
    TelemetryContextConfig, TelemetryResultConfig, TelemetrySourceConfig, build_telemetry_record,
    current_env, new_telemetry_id, serialize_telemetry_record, string_payload,
};
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};
use tauri_plugin_http::reqwest::Response;

static TRACE_CONTEXT: OnceLock<Mutex<String>> = OnceLock::new();
static SESSION_CONTEXT: OnceLock<Mutex<String>> = OnceLock::new();

fn trace_context() -> &'static Mutex<String> {
    TRACE_CONTEXT.get_or_init(|| Mutex::new(String::new()))
}

fn session_context() -> &'static Mutex<String> {
    SESSION_CONTEXT.get_or_init(|| Mutex::new(String::new()))
}

pub fn new_id() -> String {
    new_telemetry_id()
}

pub fn set_trace_id(trace_id: impl Into<String>) {
    if let Ok(mut guard) = trace_context().lock() {
        *guard = trace_id.into();
    }
}

pub fn ensure_trace_id() -> String {
    if let Ok(mut guard) = trace_context().lock() {
        if guard.is_empty() {
            *guard = new_id();
        }
        return guard.clone();
    }
    new_id()
}

pub fn ensure_session_id() -> String {
    if let Ok(mut guard) = session_context().lock() {
        if guard.is_empty() {
            *guard = new_id();
        }
        return guard.clone();
    }
    new_id()
}

pub fn capture_trace_id_from_response(response: &Response) {
    let Some(value) = response.headers().get("x-trace-id") else {
        return;
    };
    let Ok(trace_id) = value.to_str() else {
        return;
    };
    let trimmed = trace_id.trim();
    if !trimmed.is_empty() {
        set_trace_id(trimmed.to_string());
    }
}

pub fn emit_event(
    event: &str,
    level: LogLevel,
    trace_id: &str,
    attrs: BTreeMap<String, String>,
    operation: &str,
) {
    let mut payload = string_payload(attrs);
    payload.insert(
        "operation".to_string(),
        serde_json::Value::String(operation.to_string()),
    );

    let error_code = payload
        .get("code")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let error_message = payload
        .get("message")
        .and_then(|value| value.as_str())
        .map(str::to_string);

    let record = build_telemetry_record(
        event,
        level,
        TelemetrySourceConfig {
            layer: TelemetrySourceLayer::Client,
            app: "navix-client".to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            env: current_env(),
        },
        TelemetryContextConfig {
            session_id: Some(ensure_session_id()),
            trace_id: Some(trace_id.to_string()),
            platform: Some("client".to_string()),
            ..Default::default()
        },
        TelemetryResultConfig {
            error_code,
            error_message,
            ..Default::default()
        },
        Some(payload),
    );

    match serialize_telemetry_record(record.clone()) {
        Ok(line) => match level {
            LogLevel::Error | LogLevel::Fatal => log::error!("{line}"),
            LogLevel::Warn => log::warn!("{line}"),
            LogLevel::Debug => log::debug!("{line}"),
            _ => log::info!("{line}"),
        },
        Err(err) => log::error!("failed to serialize client telemetry record: {err}"),
    }
}
