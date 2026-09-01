//! 导航数据读取与站点管理 handler。

use crate::api::response::ApiResponse;
use crate::api::routes::AppState;
use crate::api::routes::jwt::Claims;
use crate::error::{ApiError, ApiResult};
use crate::models::website::{CreateWebsitePayload, NavigationGroup, UpdateWebsitePayload};
use crate::services::navigation_service;
use axum::extract::multipart::Field;
use axum::extract::{Multipart, Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::de::DeserializeOwned;
use std::sync::Arc;

const WEBSITE_PAYLOAD_MAX_BYTES: usize = 64 * 1024;

/// Web 端站点变更 multipart 中解析出的 JSON 载荷和可选图标。
struct WebsiteMultipart<T> {
    payload: T,
    icon: Option<navigation_service::ValidatedWebsiteIcon>,
}

/// 按单字段上限流式读取 multipart 内容，避免把超大文件一次性载入内存。
async fn read_limited_field(mut field: Field<'_>, limit: usize) -> ApiResult<Vec<u8>> {
    let mut data = Vec::new();
    while let Some(chunk) = field.chunk().await? {
        if data.len().saturating_add(chunk.len()) > limit {
            return Err(ApiError::BadRequest(
                if limit == WEBSITE_PAYLOAD_MAX_BYTES {
                    "Website form payload is too large".to_string()
                } else {
                    "Icon file must not exceed 5 MiB".to_string()
                },
            ));
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}

/// 解析站点创建/编辑共用的 multipart 请求。
async fn parse_website_multipart<T: DeserializeOwned>(
    mut multipart: Multipart,
) -> ApiResult<WebsiteMultipart<T>> {
    let mut payload_json: Option<String> = None;
    let mut icon = None;

    while let Some(field) = multipart.next_field().await? {
        match field.name() {
            Some("payload") => {
                if payload_json.is_some() {
                    return Err(ApiError::BadRequest(
                        "Multipart form must contain exactly one payload field".to_string(),
                    ));
                }
                let bytes = read_limited_field(field, WEBSITE_PAYLOAD_MAX_BYTES).await?;
                payload_json =
                    Some(String::from_utf8(bytes).map_err(|_| {
                        ApiError::BadRequest("Payload must be UTF-8 JSON".to_string())
                    })?);
            }
            Some("icon") => {
                if icon.is_some() {
                    return Err(ApiError::BadRequest(
                        "Multipart form must contain at most one icon field".to_string(),
                    ));
                }
                let file_name = field
                    .file_name()
                    .map(ToOwned::to_owned)
                    .ok_or(ApiError::MissingFileName)?;
                let bytes =
                    read_limited_field(field, navigation_service::WEBSITE_ICON_MAX_BYTES).await?;
                icon = Some(navigation_service::validate_website_icon(
                    &file_name, bytes,
                )?);
            }
            _ => {
                return Err(ApiError::BadRequest(
                    "Multipart form only supports payload and icon fields".to_string(),
                ));
            }
        }
    }

    let payload_json =
        payload_json.ok_or_else(|| ApiError::BadRequest("Missing payload field".to_string()))?;
    let payload = serde_json::from_str(&payload_json)
        .map_err(|_| ApiError::BadRequest("Payload is not valid JSON".to_string()))?;

    Ok(WebsiteMultipart { payload, icon })
}

/// 创建当前登录用户的导航站点。
pub async fn create_navigation_item_handler(
    claims: Claims,
    State(state): State<Arc<AppState>>,
    multipart: Multipart,
) -> ApiResult<impl IntoResponse> {
    let WebsiteMultipart { payload, icon } =
        parse_website_multipart::<CreateWebsitePayload>(multipart).await?;
    let details = payload.validate_fields();
    if !details.is_empty() {
        return Err(ApiError::ValidationDetails(details));
    }

    let website = navigation_service::create_website_for_user(
        &state.pool,
        &claims.sub,
        &payload,
        icon.as_ref(),
    )
    .await?;

    Ok(ApiResponse::success_with_status(
        "Website created successfully",
        website,
        StatusCode::CREATED.as_u16(),
    ))
}

/// 获取当前登录用户的导航数据
pub async fn get_navigation_handler(
    claims: Claims,
    State(state): State<Arc<AppState>>,
) -> ApiResult<ApiResponse<Vec<NavigationGroup>>> {
    let groups = navigation_service::fetch_navigation_for_user(&state.pool, &claims.sub).await?;
    Ok(ApiResponse::success_with_raw("导航数据获取成功", groups))
}

/// 更新当前登录用户的单个导航站点。
pub async fn update_navigation_item_handler(
    claims: Claims,
    State(state): State<Arc<AppState>>,
    Path(website_uuid): Path<String>,
    multipart: Multipart,
) -> ApiResult<impl IntoResponse> {
    let WebsiteMultipart { payload, icon } =
        parse_website_multipart::<UpdateWebsitePayload>(multipart).await?;
    let details = payload.validate_fields();
    if !details.is_empty() {
        return Err(ApiError::ValidationDetails(details));
    }
    // 站点级写接口保持极薄，字段校验和资源归属判断都下沉到 service，
    // handler 只负责把“当前登录用户”上下文注入进去。
    navigation_service::update_website_for_user(
        &state.pool,
        &claims.sub,
        &website_uuid,
        &payload,
        icon.as_ref(),
    )
    .await?;

    Ok(ApiResponse::ok("站点更新成功"))
}

/// 删除当前登录用户的单个导航站点。
pub async fn delete_navigation_item_handler(
    claims: Claims,
    State(state): State<Arc<AppState>>,
    Path(website_uuid): Path<String>,
) -> ApiResult<impl IntoResponse> {
    // 删除接口与更新接口共用同一套“当前用户只能操作自己的导航数据”边界。
    navigation_service::delete_website_for_user(&state.pool, &claims.sub, &website_uuid).await?;
    Ok(ApiResponse::ok("站点删除成功"))
}
