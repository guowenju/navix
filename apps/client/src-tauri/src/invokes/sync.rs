use crate::modules::telemetry;
use crate::types::{
    APP_CONFIG_DIR, HOME_VUST_DIR,
    session::{CurrentUserPayload, User},
    sync::{
        ApiResponse, ClientCompatibilityRequest, ClientInfoDto, ClientSyncDataChunk,
        ClientSyncPayload, CompatibilityInfo, ServerSyncData, StartSyncResponse,
    },
};

use shared_rs::dto::telemetry::LogLevel;
use std::path::PathBuf;
use std::time::Duration;
use std::{collections::BTreeMap, fs, io::Write};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_http::reqwest::{
    Client,
    header::{HeaderName, HeaderValue},
    multipart::{Form, Part},
};

fn apply_trace_headers(
    builder: tauri_plugin_http::reqwest::RequestBuilder,
    trace_id: &str,
) -> tauri_plugin_http::reqwest::RequestBuilder {
    let request_id = telemetry::new_id();
    builder
        .header(
            HeaderName::from_static("x-trace-id"),
            HeaderValue::from_str(trace_id).unwrap_or_else(|_| HeaderValue::from_static("")),
        )
        .header(
            HeaderName::from_static("x-request-id"),
            HeaderValue::from_str(&request_id).unwrap_or_else(|_| HeaderValue::from_static("")),
        )
}

fn emit_client_event(
    event: &str,
    level: LogLevel,
    trace_id: &str,
    operation: &str,
    attrs: BTreeMap<String, String>,
) {
    telemetry::emit_event(event, level, trace_id, attrs, operation);
}

#[tauri::command(rename_all = "snake_case")]
pub async fn check_server_compatibility(
    http_client: State<'_, Client>,
    server_address: String,
    payload: ClientCompatibilityRequest,
) -> Result<ApiResponse<CompatibilityInfo>, String> {
    let trace_id = telemetry::ensure_trace_id();
    emit_client_event(
        "sync.compat.check.started",
        LogLevel::Info,
        &trace_id,
        "check_server_compatibility",
        BTreeMap::from([
            ("server_address".to_string(), server_address.clone()),
            ("client_version".to_string(), payload.app_version.clone()),
            (
                "client_protocol".to_string(),
                payload.sync_protocol.to_string(),
            ),
        ]),
    );
    let url = format!("{}/api/compat", server_address);

    let response = apply_trace_headers(http_client.post(url), &trace_id)
        .json(&payload)
        .send()
        .await;

    match response {
        Ok(res) => {
            telemetry::capture_trace_id_from_response(&res);
            let status = res.status();
            let text = res
                .text()
                .await
                .map_err(|e| format!("读取响应体失败: {e}"))?;
            let parsed = serde_json::from_str::<ApiResponse<CompatibilityInfo>>(&text)
                .map_err(|e| format!("解析兼容性响应失败: {e}"))?;
            if parsed.success {
                emit_client_event(
                    "sync.compat.check.passed",
                    LogLevel::Info,
                    &trace_id,
                    "check_server_compatibility",
                    BTreeMap::from([
                        ("server_address".to_string(), server_address.clone()),
                        ("client_version".to_string(), payload.app_version.clone()),
                        (
                            "client_protocol".to_string(),
                            payload.sync_protocol.to_string(),
                        ),
                    ]),
                );
            } else {
                emit_client_event(
                    "sync.compat.check.blocked",
                    LogLevel::Warn,
                    &trace_id,
                    "check_server_compatibility",
                    BTreeMap::from([
                        ("server_address".to_string(), server_address.clone()),
                        ("http_status".to_string(), status.as_u16().to_string()),
                        ("code".to_string(), parsed.code.clone()),
                        ("message".to_string(), parsed.message.clone()),
                    ]),
                );
            }
            Ok(parsed)
        }
        Err(e) => {
            emit_client_event(
                "sync.compat.check.blocked",
                LogLevel::Error,
                &trace_id,
                "check_server_compatibility",
                BTreeMap::from([("reason".to_string(), "request_failed".to_string())]),
            );
            Err(format!("请求服务器兼容性失败: {e}"))
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn check_token_and_user(
    app: AppHandle,
    http_client: State<'_, Client>,
    client_info: ClientInfoDto,
) -> Result<String, String> {
    let trace_id = telemetry::ensure_trace_id();
    emit_client_event(
        "auth.token.verify.started",
        LogLevel::Info,
        &trace_id,
        "check_token_and_user",
        BTreeMap::from([("username".to_string(), client_info.username.clone())]),
    );

    let url = format!("{}/api/v1/auth/status", &client_info.server_address);

    let response = apply_trace_headers(http_client.get(url), &trace_id)
        .bearer_auth(client_info.token)
        .send()
        .await;

    match response {
        Ok(res) => {
            telemetry::capture_trace_id_from_response(&res);
            if !res.status().is_success() {
                let status = res.status();
                let error_text = res.text().await.unwrap_or_else(|_| "无法读取响应体".into());

                emit_client_event(
                    "auth.token.verify.failed",
                    LogLevel::Warn,
                    &trace_id,
                    "check_token_and_user",
                    BTreeMap::from([
                        ("status".to_string(), status.as_u16().to_string()),
                        ("message".to_string(), error_text.clone()),
                    ]),
                );
                return Err(error_text);
            }

            // 使用 map_err 来优雅地处理反序列化可能出现的错误，避免 .unwrap()
            match res.json::<ApiResponse<CurrentUserPayload>>().await {
                Ok(resp) => {
                    if resp.success {
                        // 判断用户名是否发生变更
                        let username_changed = resp
                            .data
                            .as_ref()
                            .is_some_and(|payload| client_info.username != payload.username);
                        let current_user_payload =
                            resp.data.expect("校验 JWT 接口响应中缺少用户数据！");
                        if username_changed {
                            app.emit_to("main", "user-rename", current_user_payload)
                                .expect("发送用户名变更事件失败！");
                        }

                        if let Some(trace) = resp.trace_id.clone() {
                            telemetry::set_trace_id(trace);
                        }
                        emit_client_event(
                            "auth.token.verify.succeeded",
                            LogLevel::Info,
                            &trace_id,
                            "check_token_and_user",
                            BTreeMap::from([
                                ("message".to_string(), resp.message.clone()),
                                ("username_changed".to_string(), username_changed.to_string()),
                            ]),
                        );
                        Ok(resp.message)
                    } else {
                        emit_client_event(
                            "auth.token.verify.failed",
                            LogLevel::Warn,
                            &trace_id,
                            "check_token_and_user",
                            BTreeMap::from([
                                ("code".to_string(), resp.code.clone()),
                                ("message".to_string(), resp.message.clone()),
                            ]),
                        );
                        Err(resp.message)
                    }
                }
                Err(e) => {
                    emit_client_event(
                        "auth.token.verify.failed",
                        LogLevel::Error,
                        &trace_id,
                        "check_token_and_user",
                        BTreeMap::from([("reason".to_string(), "deserialize_failed".to_string())]),
                    );
                    Err(format!("解析响应失败: {e}"))
                }
            }
        }
        Err(e) => {
            emit_client_event(
                "auth.token.verify.failed",
                LogLevel::Error,
                &trace_id,
                "check_token_and_user",
                BTreeMap::from([
                    ("reason".to_string(), "request_failed".to_string()),
                    ("message".to_string(), e.to_string()),
                ]),
            );
            Err("连接同步服务器失败!".to_string())
        }
    }
}

#[tauri::command]
pub async fn sync_start(
    user: User,
    payload: ClientSyncPayload,
    http_client: State<'_, Client>,
) -> Result<ApiResponse<StartSyncResponse>, String> {
    let trace_id = telemetry::ensure_trace_id();
    emit_client_event(
        "sync.session.started",
        LogLevel::Info,
        &trace_id,
        "sync_start",
        BTreeMap::from([("user_uuid".to_string(), user.uuid.clone())]),
    );
    let url = format!("{}/api/v1/sync/start", user.server_address.unwrap());
    let response = apply_trace_headers(http_client.post(url), &trace_id)
        .bearer_auth(user.token.unwrap())
        .json(&payload)
        .send()
        .await;

    match response {
        Ok(res) => {
            telemetry::capture_trace_id_from_response(&res);
            let parsed = res
                .json::<ApiResponse<StartSyncResponse>>()
                .await
                .map_err(|e| e.to_string())?;
            if let Some(trace) = parsed.trace_id.clone() {
                telemetry::set_trace_id(trace);
            }
            if parsed.success {
                emit_client_event(
                    "sync.session.acknowledged",
                    LogLevel::Info,
                    &trace_id,
                    "sync_start",
                    BTreeMap::from([(
                        "session_id".to_string(),
                        parsed
                            .data
                            .as_ref()
                            .map(|data| data.session_id.clone())
                            .unwrap_or_default(),
                    )]),
                );
            } else {
                emit_client_event(
                    "sync.session.failed",
                    LogLevel::Warn,
                    &trace_id,
                    "sync_start",
                    BTreeMap::from([("code".to_string(), parsed.code.clone())]),
                );
            }
            Ok(parsed)
        }
        Err(e) => {
            emit_client_event(
                "sync.session.failed",
                LogLevel::Error,
                &trace_id,
                "sync_start",
                BTreeMap::from([("reason".to_string(), "request_failed".to_string())]),
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn sync_chunk(
    user: User,
    payload: ClientSyncDataChunk,
    http_client: State<'_, Client>,
) -> Result<ApiResponse<()>, String> {
    let trace_id = telemetry::ensure_trace_id();
    let url = format!("{}/api/v1/sync/chunk", user.server_address.unwrap());
    let response = apply_trace_headers(http_client.post(url), &trace_id)
        .bearer_auth(user.token.unwrap())
        .json(&payload)
        .send()
        .await;
    match response {
        Ok(res) => {
            telemetry::capture_trace_id_from_response(&res);
            let parsed = res
                .json::<ApiResponse<()>>()
                .await
                .map_err(|e| e.to_string())?;
            if let Some(trace) = parsed.trace_id.clone() {
                telemetry::set_trace_id(trace);
            }
            if parsed.success {
                emit_client_event(
                    "sync.chunk.sent",
                    LogLevel::Info,
                    &trace_id,
                    "sync_chunk",
                    BTreeMap::from([
                        ("session_id".to_string(), payload.session_id.clone()),
                        ("data_type".to_string(), format!("{:?}", payload.data_type)),
                        ("chunk_index".to_string(), payload.chunk_index.to_string()),
                        ("total_chunks".to_string(), payload.total_chunks.to_string()),
                    ]),
                );
            } else {
                emit_client_event(
                    "sync.session.failed",
                    LogLevel::Warn,
                    &trace_id,
                    "sync_chunk",
                    BTreeMap::from([("code".to_string(), parsed.code.clone())]),
                );
            }
            Ok(parsed)
        }
        Err(e) => {
            emit_client_event(
                "sync.session.failed",
                LogLevel::Error,
                &trace_id,
                "sync_chunk",
                BTreeMap::from([("reason".to_string(), "request_failed".to_string())]),
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn sync_complete(
    user: User,
    session_id: String,
    http_client: State<'_, Client>,
) -> Result<ApiResponse<ServerSyncData>, String> {
    let trace_id = telemetry::ensure_trace_id();
    let url = format!("{}/api/v1/sync/complete", user.server_address.unwrap());
    let response = apply_trace_headers(http_client.post(url), &trace_id)
        .bearer_auth(user.token.unwrap())
        .json(&serde_json::json!({ "session_id": session_id }))
        .send()
        .await;

    match response {
        Ok(res) => {
            telemetry::capture_trace_id_from_response(&res);
            let parsed = res
                .json::<ApiResponse<ServerSyncData>>()
                .await
                .map_err(|e| e.to_string())?;
            if let Some(trace) = parsed.trace_id.clone() {
                telemetry::set_trace_id(trace);
            }
            if parsed.success {
                emit_client_event(
                    "sync.session.completed",
                    LogLevel::Info,
                    &trace_id,
                    "sync_complete",
                    BTreeMap::from([("session_id".to_string(), session_id.clone())]),
                );
            } else {
                emit_client_event(
                    "sync.session.failed",
                    LogLevel::Warn,
                    &trace_id,
                    "sync_complete",
                    BTreeMap::from([("code".to_string(), parsed.code.clone())]),
                );
            }
            Ok(parsed)
        }
        Err(e) => {
            emit_client_event(
                "sync.session.failed",
                LogLevel::Error,
                &trace_id,
                "sync_complete",
                BTreeMap::from([("reason".to_string(), "request_failed".to_string())]),
            );
            Err(e.to_string())
        }
    }
}

/// 从客户端接收一个图标的完整路径，并将其上传到服务器。
#[tauri::command]
pub async fn upload_icon(
    user: User,
    file_path: PathBuf,
    file_name: String,
    http_client: State<'_, Client>,
) -> Result<(), String> {
    let trace_id = telemetry::ensure_trace_id();

    let server_address = user
        .server_address
        .ok_or_else(|| "服务器地址未配置".to_string())?;
    let token = user.token.ok_or_else(|| "用户认证token丢失".to_string())?;

    let upload_url = format!("{server_address}/api/v1/icons/upload");

    let file_contents = fs::read(&file_path).map_err(|e| format!("读取文件失败: {e}"))?;

    let part = Part::bytes(file_contents).file_name(file_name.clone());
    let form = Form::new().part("icon", part);

    let response = apply_trace_headers(http_client.post(&upload_url), &trace_id)
        .bearer_auth(token)
        .timeout(Duration::from_secs(60))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("上传请求失败: {e}"))?;
    telemetry::capture_trace_id_from_response(&response);
    let response_status = response.status().as_u16();

    if response.status().is_success() {
        emit_client_event(
            "api.request.completed",
            LogLevel::Info,
            &trace_id,
            "upload_icon",
            BTreeMap::from([
                ("path".to_string(), file_path.display().to_string()),
                ("file_name".to_string(), file_name),
                ("http_status".to_string(), response_status.to_string()),
            ]),
        );
        Ok(())
    } else {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "无法读取错误响应".into());
        emit_client_event(
            "api.request.completed",
            LogLevel::Warn,
            &trace_id,
            "upload_icon",
            BTreeMap::from([
                ("path".to_string(), file_path.display().to_string()),
                ("file_name".to_string(), file_name),
                ("message".to_string(), error_text.clone()),
            ]),
        );
        Err(format!("服务器返回错误: {error_text}"))
    }
}

/// 从服务器下载指定的图标文件并保存到本地。
#[tauri::command]
pub async fn download_icon(
    app_handle: AppHandle,
    user: User,
    file_name: String,
    http_client: State<'_, Client>,
) -> Result<(), String> {
    let trace_id = telemetry::ensure_trace_id();

    let server_address = user
        .server_address
        .ok_or_else(|| "服务器地址未配置".to_string())?;
    let token = user.token.ok_or_else(|| "用户认证token丢失".to_string())?;
    let user_uuid = user.uuid;

    let download_url = format!("{server_address}/api/v1/icons/download/{user_uuid}/{file_name}");

    let icons_dir = app_handle
        .path()
        .home_dir()
        .unwrap()
        .join(HOME_VUST_DIR)
        .join(APP_CONFIG_DIR)
        .join("icons");

    if !icons_dir.exists() {
        fs::create_dir_all(&icons_dir).map_err(|e| e.to_string())?;
    }

    let dest_path = icons_dir.join(&file_name);

    let response = apply_trace_headers(http_client.get(&download_url), &trace_id)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {e}"))?;
    telemetry::capture_trace_id_from_response(&response);
    let response_status = response.status().as_u16();

    if response.status().is_success() {
        let file_bytes = response.bytes().await.map_err(|e| e.to_string())?;
        let mut file = fs::File::create(&dest_path).map_err(|e| e.to_string())?;
        file.write_all(&file_bytes).map_err(|e| e.to_string())?;
        emit_client_event(
            "api.request.completed",
            LogLevel::Info,
            &trace_id,
            "download_icon",
            BTreeMap::from([
                ("path".to_string(), dest_path.display().to_string()),
                ("file_name".to_string(), file_name),
                ("http_status".to_string(), response_status.to_string()),
            ]),
        );
        Ok(())
    } else {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "无法读取错误响应".into());
        emit_client_event(
            "api.request.completed",
            LogLevel::Warn,
            &trace_id,
            "download_icon",
            BTreeMap::from([
                ("file_name".to_string(), file_name),
                ("message".to_string(), error_text.clone()),
            ]),
        );
        Err(format!("服务器返回错误: {error_text}"))
    }
}
