//! JWT 认证路由与鉴权中间件。

use axum::{
    Json, RequestPartsExt,
    extract::{ConnectInfo, FromRequestParts, Request, State},
    http::{HeaderMap, request::Parts},
    middleware::Next,
    response::Response,
};

use crate::api::middleware::telemetry::REQUEST_ID_HEADER;
use crate::api::routes::AppState;
use crate::error::{ApiError, ApiResult};
use crate::models::refresh_token::RefreshToken;
use crate::observability::{build_server_record_raw, emit_json_log, string_payload};
use crate::services::user_service;
use axum_extra::{
    TypedHeader,
    headers::{Authorization, UserAgent, authorization::Bearer},
};
use chrono::{Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use shared_rs::dto::telemetry::LogLevel;
use shared_rs::dto::telemetry::TelemetryResultStatus;
use std::collections::BTreeMap;
use std::fmt::Display;
use std::net::SocketAddr;
use std::sync::{Arc, LazyLock};

const ACCESS_TOKEN_LIFETIME_MINUTES: i64 = 24 * 60;
const LAUNCHPAD_ICON_TOKEN_LIFETIME_MINUTES: i64 = 24 * 60;
const LAUNCHPAD_ICON_TOKEN_PURPOSE: &str = "launchpad_group_icon";
pub const SUBJECT_TYPE_USER: &str = "user";

static KEYS: LazyLock<Keys> = LazyLock::new(|| {
    let secret = std::env::var("JWT_SECRET").unwrap_or("EJlZ5ko7S&VYcI".into());
    Keys::new(secret.as_bytes())
});

fn trace_id_from_headers(headers: &HeaderMap) -> String {
    headers
        .get("x-trace-id")
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

fn emit_auth_event(
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
    payload.insert("module".to_string(), "auth".to_string());
    payload.insert("operation".to_string(), "jwt".to_string());
    record.payload = Some(string_payload(payload));
    emit_json_log(record);
}

pub async fn authorize(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    TypedHeader(user_agent): TypedHeader<UserAgent>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(payload): Json<shared_rs::dto::auth::LoginRequest>,
) -> ApiResult<Json<AuthBody>> {
    issue_user_tokens(headers, state, user_agent, addr, payload).await
}

pub async fn refresh(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    TypedHeader(user_agent): TypedHeader<UserAgent>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(payload): Json<shared_rs::dto::auth::RefreshRequest>,
) -> ApiResult<Json<AuthBody>> {
    refresh_user_tokens(headers, state, user_agent, addr, payload).await
}

async fn issue_user_tokens(
    headers: HeaderMap,
    state: Arc<AppState>,
    user_agent: UserAgent,
    addr: SocketAddr,
    payload: shared_rs::dto::auth::LoginRequest,
) -> ApiResult<Json<AuthBody>> {
    let trace_id = trace_id_from_headers(&headers);
    let request_id = request_id_from_headers(&headers);
    emit_auth_event(
        "auth.login.started",
        LogLevel::Info,
        &trace_id,
        request_id.clone(),
        BTreeMap::new(),
    );

    if payload.username.is_empty() || payload.password.is_empty() {
        emit_auth_event(
            "auth.login.failed",
            LogLevel::Warn,
            &trace_id,
            request_id.clone(),
            BTreeMap::from([("reason".to_string(), "missing_credentials".to_string())]),
        );
        return Err(ApiError::MissingCredentials);
    }

    let user = user_service::verify_user_credentials(&state.pool, &payload).await?;
    let access_token = build_access_token(
        &state,
        &user.uuid,
        &user.username,
        user.role,
        SUBJECT_TYPE_USER,
    )?;
    let refresh_token = RefreshToken::create(
        &state.pool,
        user.uuid,
        Some(user_agent.to_string()),
        Some(get_client_ip(&headers, &addr)),
    )
    .await?;
    let token_bundle = AuthBody::new(access_token).with_refresh_token(refresh_token);

    emit_auth_event(
        "auth.login.succeeded",
        LogLevel::Info,
        &trace_id,
        request_id,
        BTreeMap::new(),
    );

    Ok(Json(token_bundle))
}

async fn refresh_user_tokens(
    headers: HeaderMap,
    state: Arc<AppState>,
    user_agent: UserAgent,
    addr: SocketAddr,
    payload: shared_rs::dto::auth::RefreshRequest,
) -> ApiResult<Json<AuthBody>> {
    let trace_id = trace_id_from_headers(&headers);
    let request_id = request_id_from_headers(&headers);
    emit_auth_event(
        "auth.refresh.started",
        LogLevel::Info,
        &trace_id,
        request_id.clone(),
        BTreeMap::new(),
    );

    let refresh_token_obj = RefreshToken::find_valid_by_token(&state.pool, &payload.refresh_token)
        .await?
        .ok_or(ApiError::InvalidToken)?;
    let user = user_service::get_user_by_uuid(&state.pool, &refresh_token_obj.user_uuid)
        .await?
        .ok_or(ApiError::UserNotFound)?;

    if user.deleted_at.is_some() {
        return Err(ApiError::UserDeleted);
    }
    if user.disabled_at.is_some() {
        return Err(ApiError::UserDisabled);
    }

    let access_token = build_access_token(
        &state,
        &user.uuid,
        &user.username,
        user.role,
        SUBJECT_TYPE_USER,
    )?;
    RefreshToken::revoke_token(&state.pool, &payload.refresh_token).await?;
    let refresh_token = RefreshToken::create(
        &state.pool,
        user.uuid,
        Some(user_agent.to_string()),
        Some(get_client_ip(&headers, &addr)),
    )
    .await?;
    let token_bundle = AuthBody::new(access_token).with_refresh_token(refresh_token);

    emit_auth_event(
        "auth.refresh.succeeded",
        LogLevel::Info,
        &trace_id,
        request_id,
        BTreeMap::new(),
    );

    Ok(Json(token_bundle))
}

fn build_access_token(
    state: &Arc<AppState>,
    subject_uuid: &str,
    username: &str,
    role: String,
    subject_type: &str,
) -> ApiResult<String> {
    let expiration_time = Utc::now()
        .checked_add_signed(Duration::minutes(ACCESS_TOKEN_LIFETIME_MINUTES))
        .expect("valid timestamp")
        .timestamp();

    let mut claims = Claims::new(
        subject_uuid,
        expiration_time as usize,
        username,
        state.server_instance_uuid.to_string(),
        subject_type,
    );
    claims.roles.push(role);

    encode(&Header::default(), &claims, &KEYS.encoding).map_err(|_| ApiError::TokenCreation)
}

/// 签发仅允许当前 Web 页面读取指定分组图标的短期凭据。
pub fn issue_launchpad_icon_token(
    server_instance_uuid: uuid::Uuid,
    user_uuid: &str,
    group_uuid: &str,
) -> ApiResult<String> {
    let expiration_time = Utc::now()
        .checked_add_signed(Duration::minutes(LAUNCHPAD_ICON_TOKEN_LIFETIME_MINUTES))
        .expect("valid timestamp")
        .timestamp();
    let claims = LaunchpadIconClaims {
        sub: user_uuid.to_string(),
        group_uuid: group_uuid.to_string(),
        exp: expiration_time as usize,
        iss: server_instance_uuid.to_string(),
        purpose: LAUNCHPAD_ICON_TOKEN_PURPOSE.to_string(),
    };
    encode(&Header::default(), &claims, &KEYS.encoding).map_err(|_| ApiError::TokenCreation)
}

/// 校验 Web 分组图标凭据是否属于当前用户与目标分组。
pub fn validate_launchpad_icon_token(
    server_instance_uuid: uuid::Uuid,
    token: &str,
    user_uuid: &str,
    group_uuid: &str,
) -> ApiResult<()> {
    let claims = decode::<LaunchpadIconClaims>(token, &KEYS.decoding, &Validation::default())
        .map_err(|_| ApiError::ForbiddenResource)?
        .claims;
    if claims.iss != server_instance_uuid.to_string()
        || claims.sub != user_uuid
        || claims.group_uuid != group_uuid
        || claims.purpose != LAUNCHPAD_ICON_TOKEN_PURPOSE
    {
        return Err(ApiError::ForbiddenResource);
    }
    Ok(())
}

/// 提取客户端真实 IP（优先代理头，其次连接地址）。
fn get_client_ip(headers: &HeaderMap, addr: &SocketAddr) -> String {
    let remote_ip = addr.ip().to_string();
    let proxy_ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("").trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        });

    proxy_ip.unwrap_or(remote_ip)
}

/// JWT 编解码密钥容器。
struct Keys {
    encoding: EncodingKey,
    decoding: DecodingKey,
}

impl Keys {
    /// 根据共享密钥初始化编码与解码密钥。
    fn new(secret: &[u8]) -> Self {
        Self {
            encoding: EncodingKey::from_secret(secret),
            decoding: DecodingKey::from_secret(secret),
        }
    }
}

/// Web 分组解锁后用于读取本地图标的短期 JWT 载荷。
#[derive(Debug, Serialize, Deserialize)]
struct LaunchpadIconClaims {
    sub: String,
    group_uuid: String,
    exp: usize,
    iss: String,
    purpose: String,
}

/// 鉴权上下文载荷。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
    #[serde(default = "default_issuer")]
    pub iss: String,
    #[serde(default = "default_subject_type")]
    pub subject_type: String,
    pub username: String,
    #[serde(default)]
    pub roles: Vec<String>,
}

impl Claims {
    /// 构造新的 claims。
    pub fn new(sub: &str, exp: usize, username: &str, iss: String, subject_type: &str) -> Self {
        Self {
            sub: sub.to_string(),
            exp,
            iss,
            subject_type: subject_type.to_string(),
            username: username.to_string(),
            roles: Vec::new(),
        }
    }
}

impl Display for Claims {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Username: {}, SubjectType: {}, Roles: {:?}",
            self.username, self.subject_type, self.roles
        )
    }
}

impl<S> FromRequestParts<S> for Claims
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    /// 从请求头提取并校验 Bearer Token。
    async fn from_request_parts(
        parts: &mut Parts,
        _state: &S,
    ) -> std::result::Result<Self, Self::Rejection> {
        if let Some(claims) = parts.extensions.get::<Claims>() {
            return Ok(claims.clone());
        }

        let TypedHeader(Authorization(bearer)) = parts
            .extract::<TypedHeader<Authorization<Bearer>>>()
            .await
            .map_err(|_| ApiError::InvalidToken)?;

        let token_data =
            match decode::<Claims>(bearer.token(), &KEYS.decoding, &Validation::default()) {
                Ok(token_data) => token_data,
                Err(err) => match err.kind() {
                    jsonwebtoken::errors::ErrorKind::ExpiredSignature => {
                        return Err(ApiError::TokenExpired);
                    }
                    _ => return Err(ApiError::InvalidToken),
                },
            };

        Ok(token_data.claims)
    }
}

fn validate_server_instance(claims: &Claims, state: &AppState) -> ApiResult<()> {
    if claims.iss != state.server_instance_uuid.to_string() {
        return Err(ApiError::InvalidToken);
    }
    Ok(())
}

fn validate_subject_type(claims: &Claims, expected_subject_type: &str) -> ApiResult<()> {
    if claims.subject_type != expected_subject_type {
        return Err(ApiError::ForbiddenResource);
    }
    Ok(())
}

fn default_issuer() -> String {
    env!("CARGO_CRATE_NAME").to_string()
}

fn default_subject_type() -> String {
    SUBJECT_TYPE_USER.to_string()
}

/// 登录与刷新接口的返回体。
#[derive(Debug, Serialize)]
pub struct AuthBody {
    access_token: String,
    token_type: String,
    refresh_token: String,
}

impl AuthBody {
    /// 构造仅含 access_token 的响应体。
    fn new(access_token: String) -> Self {
        Self {
            access_token,
            token_type: "Bearer".to_string(),
            refresh_token: "".to_string(),
        }
    }

    /// 返回带 refresh_token 的响应体。
    fn with_refresh_token(self, refresh_token: String) -> Self {
        Self {
            refresh_token,
            ..self
        }
    }
}

pub type UserClaims = Claims;
/// 普通用户 JWT 鉴权中间件。
pub async fn user_auth_layer(
    State(state): State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> ApiResult<Response> {
    let (mut parts, body) = req.into_parts();
    let claims = Claims::from_request_parts(&mut parts, &()).await?;
    validate_server_instance(&claims, &state)?;
    validate_subject_type(&claims, SUBJECT_TYPE_USER)?;
    parts.extensions.insert(claims);
    let req = Request::from_parts(parts, body);
    Ok(next.run(req).await)
}

/// 管理员鉴权中间件。
pub async fn admin_only(req: Request, next: Next) -> ApiResult<Response> {
    let claims = req
        .extensions()
        .get::<Claims>()
        .ok_or(ApiError::ForbiddenResource)?;

    let is_admin = claims
        .roles
        .iter()
        .any(|role| role == crate::models::user::ROLE_ADMIN);

    if !is_admin {
        return Err(ApiError::ForbiddenResource);
    }

    Ok(next.run(req).await)
}

#[cfg(test)]
mod tests {
    use super::{issue_launchpad_icon_token, validate_launchpad_icon_token};
    use crate::error::ApiError;
    use uuid::Uuid;

    #[test]
    fn launchpad_icon_token_is_scoped_to_user_group_and_server() {
        let server_uuid = Uuid::new_v4();
        let token = issue_launchpad_icon_token(server_uuid, "user-a", "group-a").unwrap();

        validate_launchpad_icon_token(server_uuid, &token, "user-a", "group-a").unwrap();
        assert!(matches!(
            validate_launchpad_icon_token(server_uuid, &token, "user-a", "group-b"),
            Err(ApiError::ForbiddenResource)
        ));
        assert!(matches!(
            validate_launchpad_icon_token(Uuid::new_v4(), &token, "user-a", "group-a"),
            Err(ApiError::ForbiddenResource)
        ));
    }
}
