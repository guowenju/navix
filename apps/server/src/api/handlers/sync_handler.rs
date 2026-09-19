use crate::api::middleware::telemetry::REQUEST_ID_HEADER;
use crate::observability::{build_server_record_raw, emit_json_log, string_payload};
use crate::{
    api::middleware::telemetry::TRACE_ID_HEADER,
    api::response::ApiResponse,
    api::routes::{AppState, jwt::Claims},
    config::STORAGE_BASE_DIR,
    error::{ApiError, ApiResult},
    models::sync::{
        ClientSyncData, ClientSyncDataChunk, ClientSyncPayload, CompleteSyncPayload,
        ServerSyncData, StartSyncResponse,
    },
    services::{sync_service, sync_session_persist},
    utils::is_safe_path_segment,
};
use axum::{
    Json,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use shared_rs::dto::telemetry::{LogLevel, TelemetryResultStatus};
use sqlx::Error as SqlxError;
use std::{collections::BTreeMap, path::PathBuf as StdPathBuf, sync::Arc, time::UNIX_EPOCH};
use tokio::fs;
use tokio_util::io::ReaderStream;

fn ensure_session_owner(claims: &Claims, session_user_uuid: &str) -> ApiResult<()> {
    if claims.sub != session_user_uuid {
        return Err(ApiError::SyncSessionInvalid(
            "会话归属与当前用户不匹配".to_string(),
        ));
    }
    Ok(())
}

fn trace_id_from_headers(headers: &HeaderMap) -> String {
    headers
        .get(TRACE_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn request_id_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get(REQUEST_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
}

fn emit_sync_event(
    event: &str,
    level: LogLevel,
    trace_id: &str,
    request_id: Option<String>,
    attrs: BTreeMap<String, String>,
) {
    let mut record = build_server_record_raw(event, level, env!("CARGO_PKG_VERSION"));
    record.context.trace_id = trace_id.to_string();
    record.context.request_id = request_id;
    record.context.route = Some(event.to_string());
    record.result.status = if matches!(level, LogLevel::Error | LogLevel::Warn | LogLevel::Fatal) {
        TelemetryResultStatus::Fail.as_str().to_string()
    } else {
        TelemetryResultStatus::Success.as_str().to_string()
    };
    record.result.error_code = attrs.get("code").cloned();
    record.result.error_message = attrs.get("message").cloned();
    let mut payload = attrs;
    payload.insert("module".to_string(), "sync".to_string());
    payload.insert("operation".to_string(), "handler".to_string());
    record.payload = Some(string_payload(payload));
    emit_json_log(record);
}

/// 处理图标上传
pub async fn icon_upload_handler(
    claims: Claims,
    mut multipart: axum::extract::Multipart,
) -> ApiResult<Response> {
    while let Some(field) = multipart.next_field().await.unwrap() {
        if field.name() == Some("icon") {
            let file_name = field.file_name().unwrap_or("unknown_icon").to_string();
            let data = field.bytes().await.unwrap();

            let user_icon_dir = StdPathBuf::from(STORAGE_BASE_DIR).join(claims.sub);
            tokio::fs::create_dir_all(&user_icon_dir).await.unwrap();

            let path = user_icon_dir.join(file_name);
            tokio::fs::write(&path, &data).await.unwrap();

            return Ok(ApiResponse::success_msg("图标上传成功", 201).into_response());
        }
    }
    Err(ApiError::BadRequest("缺少 'icon' 字段".to_string()))
}

/// 处理图标下载
pub async fn icon_download_handler(
    request_headers: HeaderMap,
    claims: Claims,
    Path((user_uuid, file_name)): Path<(String, String)>,
) -> ApiResult<Response> {
    if claims.sub != user_uuid {
        return Err(ApiError::ForbiddenResource);
    }

    serve_user_icon(&request_headers, &user_uuid, &file_name).await
}

/// 从当前用户的图标目录安全地读取文件并构造带缓存头的下载响应。
pub async fn serve_user_icon(
    request_headers: &HeaderMap,
    user_uuid: &str,
    file_name: &str,
) -> ApiResult<Response> {
    if !is_safe_path_segment(user_uuid) || !is_safe_path_segment(file_name) {
        return Err(ApiError::ForbiddenResource);
    }

    let storage_root = fs::canonicalize(STORAGE_BASE_DIR)
        .await
        .map_err(|_| ApiError::ResourceNotFound)?;
    let file_path = StdPathBuf::from(STORAGE_BASE_DIR)
        .join(user_uuid)
        .join(file_name);
    let canonical_file = fs::canonicalize(&file_path)
        .await
        .map_err(|_| ApiError::NotFound)?;

    if !canonical_file.starts_with(&storage_root) {
        return Err(ApiError::ForbiddenResource);
    }

    let metadata = tokio::fs::metadata(&canonical_file)
        .await
        .map_err(|_| ApiError::NotFound)?;
    let modified = metadata.modified().ok();
    let etag = modified
        .and_then(|mtime| mtime.duration_since(UNIX_EPOCH).ok())
        .map(|duration| format!("W/\"{}-{}\"", metadata.len(), duration.as_secs()));
    let last_modified = modified.map(httpdate::fmt_http_date);

    let if_none_match = request_headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok());
    if let (Some(etag_value), Some(if_none_match_value)) = (&etag, if_none_match)
        && if_none_match_value == etag_value
    {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CACHE_CONTROL,
            "private, max-age=86400".parse().unwrap(),
        );
        headers.insert(header::ETAG, etag_value.parse().unwrap());
        if let Some(last_modified_value) = &last_modified {
            headers.insert(header::LAST_MODIFIED, last_modified_value.parse().unwrap());
        }
        return Ok((StatusCode::NOT_MODIFIED, headers).into_response());
    }

    if if_none_match.is_none()
        && let (Some(last_modified_value), Some(if_modified_since)) = (
            &last_modified,
            request_headers
                .get(header::IF_MODIFIED_SINCE)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| httpdate::parse_http_date(value).ok()),
        )
        && let Ok(modified_time) = httpdate::parse_http_date(last_modified_value)
        && modified_time <= if_modified_since
    {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CACHE_CONTROL,
            "private, max-age=86400".parse().unwrap(),
        );
        if let Some(etag_value) = &etag {
            headers.insert(header::ETAG, etag_value.parse().unwrap());
        }
        headers.insert(header::LAST_MODIFIED, last_modified_value.parse().unwrap());
        return Ok((StatusCode::NOT_MODIFIED, headers).into_response());
    }

    let file = tokio::fs::File::open(canonical_file).await?;
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let mut headers = HeaderMap::new();
    let content_type = mime_guess::from_path(file_name)
        .first_or_octet_stream()
        .to_string();
    headers.insert(header::CONTENT_TYPE, content_type.parse().unwrap());
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("inline; filename=\"{}\"", file_name)
            .parse()
            .unwrap(),
    );
    headers.insert(
        header::CACHE_CONTROL,
        "private, max-age=86400".parse().unwrap(),
    );
    if let Some(etag_value) = etag {
        headers.insert(header::ETAG, etag_value.parse().unwrap());
    }
    if let Some(last_modified_value) = last_modified {
        headers.insert(header::LAST_MODIFIED, last_modified_value.parse().unwrap());
    }

    Ok((StatusCode::OK, headers, body).into_response())
}

/// 处理 /sync/start 请求
pub async fn sync_start_handler(
    headers: HeaderMap,
    claims: Claims,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ClientSyncPayload>,
) -> ApiResult<ApiResponse<StartSyncResponse>> {
    let trace_id = trace_id_from_headers(&headers);
    let request_id = request_id_from_headers(&headers);
    emit_sync_event(
        "sync.session.started",
        LogLevel::Info,
        &trace_id,
        request_id.clone(),
        BTreeMap::new(),
    );
    if claims.sub != payload.user_uuid {
        emit_sync_event(
            "sync.session.failed",
            LogLevel::Warn,
            &trace_id,
            request_id,
            BTreeMap::from([("reason".to_string(), "forbidden_user_mismatch".to_string())]),
        );
        return Err(ApiError::ForbiddenResource);
    }

    let session_id = state
        .sync_session_manager
        .start_session(payload.user_uuid, payload.last_synced_rev);

    let suggested_chunk_size = std::env::var("SYNC_SUGGESTED_CHUNK_SIZE")
        .ok()
        .and_then(|v| v.parse::<usize>().ok());

    // 持久化会话，用于 ACK/重试/TTL 清理
    sync_session_persist::create_session(
        &state.pool,
        session_id.clone(),
        claims.sub.clone(),
        payload.last_synced_rev,
    )
    .await
    .map_err(|e| ApiError::Internal(format!("创建会话失败: {}", e)))?;

    Ok(ApiResponse::success_with_raw(
        "会话已开启",
        StartSyncResponse {
            session_id,
            server_instance_uuid: state.server_instance_uuid.to_string(),
            suggested_chunk_size,
        },
    ))
}

/// 处理 /sync/chunk 请求
pub async fn sync_chunk_handler(
    headers: HeaderMap,
    claims: Claims,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ClientSyncDataChunk>,
) -> ApiResult<ApiResponse<()>> {
    let trace_id = trace_id_from_headers(&headers);
    let request_id = request_id_from_headers(&headers);
    // ACK 之前先校验会话是否有效且未过期
    let session =
        match sync_session_persist::ensure_session_active(&state.pool, &payload.session_id).await {
            Ok(session) => session,
            Err(e) => {
                emit_sync_event(
                    "sync.session.failed",
                    LogLevel::Warn,
                    &trace_id,
                    request_id.clone(),
                    BTreeMap::from([("reason".to_string(), "session_not_active".to_string())]),
                );
                return match e.downcast_ref::<SqlxError>() {
                    Some(SqlxError::RowNotFound) => Err(ApiError::SyncSessionInvalid(
                        "会话不存在、已过期或已完成".to_string(),
                    )),
                    _ => Err(ApiError::Internal(format!("查询会话失败: {}", e))),
                };
            }
        };
    ensure_session_owner(&claims, &session.user_uuid)?;

    let server_checksum = payload.chunk_data.to_string();
    let checksum_matches = payload.chunk_checksum == server_checksum
        || serde_json::from_str::<serde_json::Value>(&payload.chunk_checksum)
            .is_ok_and(|client_checksum_value| client_checksum_value == payload.chunk_data);
    if !checksum_matches {
        emit_sync_event(
            "sync.session.failed",
            LogLevel::Warn,
            &trace_id,
            request_id.clone(),
            BTreeMap::from([("reason".to_string(), "chunk_checksum_mismatch".to_string())]),
        );
        return Err(ApiError::SyncSessionInvalid(
            "chunk_checksum 与 chunk_data 不一致".to_string(),
        ));
    }
    if payload.chunk_index < 0 || payload.total_chunks <= 0 {
        emit_sync_event(
            "sync.session.failed",
            LogLevel::Warn,
            &trace_id,
            request_id.clone(),
            BTreeMap::from([("reason".to_string(), "invalid_chunk_index".to_string())]),
        );
        return Err(ApiError::SyncSessionInvalid(
            "chunk_index 或 total_chunks 非法".to_string(),
        ));
    }

    state
        .sync_session_manager
        .add_chunk(
            &payload.session_id,
            payload.data_type.clone(),
            payload.chunk_index as usize,
            payload.total_chunks as usize,
            payload.chunk_data.clone(),
        )
        .map_err(|e| ApiError::SyncSessionInvalid(e.to_string()))?;

    // 记录分块，保证幂等；checksum 用服务器端计算，避免客户端差异
    let checksum = format!("{:x}", md5::compute(server_checksum));
    sync_session_persist::upsert_chunk(
        &state.pool,
        &payload.session_id,
        &payload.data_type,
        payload.chunk_index,
        &checksum,
    )
    .await
    .map_err(|e| ApiError::SyncSessionInvalid(format!("记录分块失败: {}", e)))?;

    emit_sync_event(
        "sync.chunk.received",
        LogLevel::Info,
        &trace_id,
        request_id,
        BTreeMap::new(),
    );

    Ok(ApiResponse::ok("数据块已接收"))
}

/// 处理 /sync/complete 请求
pub async fn sync_complete_handler(
    headers: HeaderMap,
    claims: Claims,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CompleteSyncPayload>,
) -> ApiResult<ApiResponse<ServerSyncData>> {
    let trace_id = trace_id_from_headers(&headers);
    let request_id = request_id_from_headers(&headers);
    // 先校验会话活跃态与归属，不消费会话，失败可重试。
    let persisted_session =
        match sync_session_persist::ensure_session_active(&state.pool, &payload.session_id).await {
            Ok(session) => session,
            Err(e) => {
                emit_sync_event(
                    "sync.session.failed",
                    LogLevel::Warn,
                    &trace_id,
                    request_id.clone(),
                    BTreeMap::from([("reason".to_string(), "session_not_active".to_string())]),
                );
                return match e.downcast_ref::<SqlxError>() {
                    Some(SqlxError::RowNotFound) => Err(ApiError::SyncSessionInvalid(
                        "会话不存在、已过期或已完成".to_string(),
                    )),
                    _ => Err(ApiError::Internal(format!("查询会话失败: {}", e))),
                };
            }
        };
    ensure_session_owner(&claims, &persisted_session.user_uuid)?;

    // 组装数据（不移除会话）
    let (session, combined_data, local_icons) = state
        .sync_session_manager
        .build_session_data(&payload.session_id)
        .map_err(|e| ApiError::SyncSessionInvalid(e.to_string()))?;

    // 权限验证
    ensure_session_owner(&claims, &session.user_uuid)?;

    tracing::info!(
        "用户 '{}' (UUID: {}) 正在完成同步...",
        claims.username,
        claims.sub,
    );

    let client_sync_data = ClientSyncData {
        user_uuid: session.user_uuid,
        last_synced_rev: session.last_synced_rev,
        sync_data: combined_data,
        local_icons,
    };

    match sync_service::process_data_sync(&state.pool, claims, client_sync_data).await {
        Ok(data) => {
            // 标记会话完成
            let _ = state
                .sync_session_manager
                .finish_session(&payload.session_id);
            let _ = sync_session_persist::complete_session(&state.pool, &payload.session_id).await;
            emit_sync_event(
                "sync.session.completed",
                LogLevel::Info,
                &trace_id,
                request_id.clone(),
                BTreeMap::new(),
            );
            Ok(ApiResponse::success_with_raw("数据合并与写入完成", data))
        }
        Err(e) => {
            emit_sync_event(
                "sync.session.failed",
                LogLevel::Error,
                &trace_id,
                request_id,
                BTreeMap::from([("reason".to_string(), "process_data_sync_failed".to_string())]),
            );
            Err(ApiError::Internal(e.to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ensure_session_owner;
    use crate::api::routes::jwt::Claims;
    use crate::error::ApiError;

    #[test]
    fn ensure_session_owner_rejects_mismatch() {
        let claims = Claims {
            sub: "user-a".to_string(),
            exp: 0,
            iss: "test".to_string(),
            subject_type: "user".to_string(),
            username: "u".to_string(),
            roles: vec![],
        };

        let result = ensure_session_owner(&claims, "user-b");
        match result {
            Err(ApiError::SyncSessionInvalid(_)) => {}
            _ => panic!("expected ApiError::SyncSessionInvalid"),
        }
    }
}
