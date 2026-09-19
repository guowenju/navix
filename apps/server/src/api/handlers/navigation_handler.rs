//! 导航数据读取与站点管理 handler。

use crate::api::handlers::sync_handler::serve_user_icon;
use crate::api::response::ApiResponse;
use crate::api::routes::AppState;
use crate::api::routes::jwt::{self, Claims};
use crate::error::{ApiError, ApiResult};
use crate::models::website::{
    CreateWebsitePayload, LaunchpadLockPasswordPayload, LaunchpadLockPayload,
    LaunchpadUnlockPayload, LaunchpadUnlockResponse, NavigationGroup, ReorderWebsiteItemsPayload,
    UpdateWebsitePayload,
};
use crate::services::navigation_service;
use axum::extract::multipart::Field;
use axum::extract::{Json, Multipart, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::de::DeserializeOwned;
use std::sync::Arc;

const WEBSITE_PAYLOAD_MAX_BYTES: usize = 64 * 1024;
const LAUNCHPAD_ICON_TOKEN_HEADER: &str = "x-launchpad-unlock-token";

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

/// 获取当前用户的 Web 分组锁密码状态。
pub async fn get_launchpad_lock_password_status_handler(
    claims: Claims,
    State(state): State<Arc<AppState>>,
) -> ApiResult<ApiResponse<crate::models::website::LaunchpadLockPasswordStatus>> {
    let status = navigation_service::get_lock_password_status(&state.pool, &claims.sub).await?;
    Ok(ApiResponse::success_with_raw(
        "分组锁密码状态获取成功",
        status,
    ))
}

/// 设置或修改当前用户的 Web 分组锁密码。
pub async fn set_launchpad_lock_password_handler(
    claims: Claims,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LaunchpadLockPasswordPayload>,
) -> ApiResult<impl IntoResponse> {
    navigation_service::set_lock_password(&state.pool, &claims.sub, &payload).await?;
    Ok(ApiResponse::ok("分组锁密码已更新"))
}

/// 清除当前用户的 Web 分组锁密码配置并解除全部分组锁。
pub async fn clear_launchpad_lock_password_handler(
    claims: Claims,
    State(state): State<Arc<AppState>>,
) -> ApiResult<impl IntoResponse> {
    navigation_service::clear_lock_password(&state.pool, &claims.sub).await?;
    Ok(ApiResponse::ok("分组锁密码已清除，所有分组锁已解除"))
}

/// 验证密码并返回当前分组的完整导航数据。
pub async fn unlock_launchpad_group_handler(
    claims: Claims,
    State(state): State<Arc<AppState>>,
    Path(group_uuid): Path<String>,
    Json(payload): Json<LaunchpadUnlockPayload>,
) -> ApiResult<ApiResponse<LaunchpadUnlockResponse>> {
    let group =
        navigation_service::unlock_group(&state.pool, &claims.sub, &group_uuid, &payload).await?;
    let icon_access_token =
        jwt::issue_launchpad_icon_token(state.server_instance_uuid, &claims.sub, &group_uuid)?;
    Ok(ApiResponse::success_with_raw(
        "分组解锁成功",
        LaunchpadUnlockResponse {
            group,
            icon_access_token,
        },
    ))
}

/// 使用分组解锁凭据读取当前 Web 页面已解锁分组中的本地图标。
pub async fn download_unlocked_launchpad_icon_handler(
    request_headers: HeaderMap,
    claims: Claims,
    State(state): State<Arc<AppState>>,
    Path((group_uuid, file_name)): Path<(String, String)>,
) -> ApiResult<Response> {
    let icon_access_token = request_headers
        .get(LAUNCHPAD_ICON_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or(ApiError::ForbiddenResource)?;
    jwt::validate_launchpad_icon_token(
        state.server_instance_uuid,
        icon_access_token,
        &claims.sub,
        &group_uuid,
    )?;

    let icon_belongs_to_group: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM websites WHERE user_uuid = ?1 AND group_uuid = ?2 AND local_icon_path = ?3 AND is_deleted = 0 LIMIT 1",
    )
    .bind(&claims.sub)
    .bind(&group_uuid)
    .bind(&file_name)
    .fetch_optional(&state.pool)
    .await?;
    if icon_belongs_to_group.is_none() {
        return Err(ApiError::ResourceNotFound);
    }

    serve_user_icon(&request_headers, &claims.sub, &file_name).await
}

/// 修改当前用户指定分组的持久锁定状态。
pub async fn set_launchpad_group_lock_handler(
    claims: Claims,
    State(state): State<Arc<AppState>>,
    Path(group_uuid): Path<String>,
    Json(payload): Json<LaunchpadLockPayload>,
) -> ApiResult<impl IntoResponse> {
    navigation_service::set_group_lock(&state.pool, &claims.sub, &group_uuid, &payload).await?;
    Ok(ApiResponse::ok("分组锁定状态已更新"))
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
    let website = navigation_service::update_website_for_user(
        &state.pool,
        &claims.sub,
        &website_uuid,
        &payload,
        icon.as_ref(),
    )
    .await?;

    Ok(ApiResponse::success_with_raw("站点更新成功", website))
}

/// 更新当前登录用户指定分组内的完整站点顺序。
pub async fn reorder_navigation_items_handler(
    claims: Claims,
    State(state): State<Arc<AppState>>,
    Path(group_uuid): Path<String>,
    Json(payload): Json<ReorderWebsiteItemsPayload>,
) -> ApiResult<impl IntoResponse> {
    navigation_service::reorder_websites_for_user(
        &state.pool,
        &claims.sub,
        &group_uuid,
        &payload.item_uuids,
    )
    .await?;

    Ok(ApiResponse::ok("Website order updated successfully"))
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
