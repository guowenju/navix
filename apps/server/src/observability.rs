//! 服务端结构化日志 adapter。
//!
//! 业务侧只通过本模块输出 telemetry；底层构造、事件名归一化与脱敏复用
//! `shared-rs`，这里仅负责填充服务端默认来源并路由到 `tracing`。

use serde_json::Value;
use shared_rs::dto::telemetry::{
    LogLevel, ObservabilityEvent, TelemetryRecord, TelemetrySourceLayer,
};
use shared_rs::telemetry::{
    TelemetryContextConfig, TelemetryResultConfig, TelemetrySourceConfig, build_telemetry_record,
    current_env, json_payload as shared_json_payload, new_telemetry_id, serialize_telemetry_record,
    string_payload as shared_string_payload,
};
use std::collections::BTreeMap;

pub fn new_event_id() -> String {
    new_telemetry_id()
}

pub fn json_payload(entries: impl IntoIterator<Item = (String, Value)>) -> BTreeMap<String, Value> {
    shared_json_payload(entries)
}

pub fn string_payload(
    entries: impl IntoIterator<Item = (String, String)>,
) -> BTreeMap<String, Value> {
    shared_string_payload(entries)
}

pub fn build_server_record(
    event: ObservabilityEvent,
    level: LogLevel,
    app_version: &str,
) -> TelemetryRecord {
    build_server_record_raw(event.as_str(), level, app_version)
}

pub fn build_server_record_raw(
    event_name: &str,
    level: LogLevel,
    app_version: &str,
) -> TelemetryRecord {
    build_server_record_with_context(
        event_name,
        level,
        app_version,
        TelemetryContextConfig {
            platform: Some("server".to_string()),
            ..Default::default()
        },
        TelemetryResultConfig::default(),
        None,
    )
}

pub fn build_server_record_with_context(
    event_name: &str,
    level: LogLevel,
    app_version: &str,
    context: TelemetryContextConfig,
    result: TelemetryResultConfig,
    payload: Option<BTreeMap<String, Value>>,
) -> TelemetryRecord {
    build_telemetry_record(
        event_name,
        level,
        TelemetrySourceConfig {
            layer: TelemetrySourceLayer::Server,
            app: "navix-server".to_string(),
            app_version: app_version.to_string(),
            env: current_env(),
        },
        context,
        result,
        payload,
    )
}

pub fn emit_json_log(record: TelemetryRecord) {
    match serialize_telemetry_record(record.clone()) {
        Ok(line) => match record.level.as_str() {
            "DEBUG" => tracing::debug!("{line}"),
            "WARN" => tracing::warn!("{line}"),
            "ERROR" | "FATAL" => tracing::error!("{line}"),
            _ => tracing::info!("{line}"),
        },
        Err(err) => tracing::error!("failed to serialize telemetry record: {err}"),
    }
}
