use crate::api::handlers::admin_handler::{
    cleanup_user_handler, create_user_handler, delete_user_handler, disable_user_handler,
    enable_user_handler, list_users_handler,
};
use crate::api::handlers::navigation_handler::{
    create_navigation_item_handler, delete_navigation_item_handler, get_navigation_handler,
    reorder_navigation_items_handler, update_navigation_item_handler,
};
use crate::api::handlers::sync_handler::{
    icon_download_handler, icon_upload_handler, sync_chunk_handler, sync_complete_handler,
    sync_start_handler,
};
use crate::api::handlers::user_handler::{
    bootstrap_init_handler, bootstrap_status_handler, change_password_handler,
    change_username_handler,
};
use crate::api::routes::{
    AppState,
    jwt::{self, authorize, refresh},
};
use crate::services::session_service::{
    check_auth_status_handler, check_compatibility_handler, get_version_info, welcome,
};
use axum::{
    Router, middleware,
    routing::{delete, get, post, put},
};
use std::sync::Arc;

/// 只包含公共路由的函数
pub fn public_api_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/bootstrap/status", get(bootstrap_status_handler))
        .route("/bootstrap/init", post(bootstrap_init_handler))
        .route("/version", get(get_version_info))
        .route("/compat", post(check_compatibility_handler))
}

/// 只包含不需要 v1 路由的函数
pub fn state_api_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/login", post(authorize))
        .route("/refresh", post(refresh))
}

/// 包含 v1 Sync 路由的函数
pub fn v1_sync() -> Router<Arc<AppState>> {
    Router::new()
        .route("/sync/start", post(sync_start_handler))
        .route("/sync/chunk", post(sync_chunk_handler))
        .route("/sync/complete", post(sync_complete_handler))
        .route("/icons/upload", post(icon_upload_handler))
        .route(
            "/icons/download/{user_uuid}/{file_name}",
            get(icon_download_handler),
        )
}

/// 超级管理员路由
pub fn v1_admin() -> Router<Arc<AppState>> {
    Router::new()
        .route("/users", post(create_user_handler))
        .route("/users", get(list_users_handler))
        .route("/users/{uuid}/disable", post(disable_user_handler))
        .route("/users/{uuid}/enable", post(enable_user_handler))
        .route("/users/{uuid}/cleanup", post(cleanup_user_handler))
        .route("/users/{uuid}", delete(delete_user_handler))
        .route_layer(middleware::from_fn(jwt::admin_only))
}

/// 包含所有 v1 路由的函数
pub fn protected_api_v1_protected() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/status", get(check_auth_status_handler))
        .route("/launchpad", get(get_navigation_handler))
        .route("/launchpad/items", post(create_navigation_item_handler))
        .route(
            "/launchpad/items/{uuid}",
            put(update_navigation_item_handler),
        )
        .route(
            "/launchpad/items/{uuid}",
            delete(delete_navigation_item_handler),
        )
        .route(
            "/launchpad/groups/{group_uuid}/items/order",
            put(reorder_navigation_items_handler),
        )
        .route("/welcome", get(welcome))
        .route("/user/username", put(change_username_handler))
        .route("/user/password", put(change_password_handler))
        .merge(v1_sync())
}

pub fn protected_admin_api_v1() -> Router<Arc<AppState>> {
    Router::new().nest("/admin", v1_admin())
}

#[cfg(test)]
mod tests {
    use super::{
        protected_admin_api_v1, protected_api_v1_protected, public_api_router, state_api_router,
    };
    use crate::api::middleware::telemetry::{
        REQUEST_ID_HEADER, TRACE_ID_HEADER, request_telemetry_layer,
    };
    use crate::api::routes::AppState;
    use crate::api::routes::jwt;
    use crate::db::connection::establish_connection;
    use crate::services::sync_session_service::SessionManager;
    use axum::Router;
    use axum::body::{Body, to_bytes};
    use axum::extract::connect_info::ConnectInfo;
    use axum::http::{Request, StatusCode};
    use axum::middleware;
    use serde::Deserialize;
    use serde_json::{Value, json};
    use std::net::{Ipv4Addr, SocketAddr};
    use std::sync::Arc;
    use tower::util::ServiceExt;
    use uuid::Uuid;

    #[derive(Debug, Deserialize)]
    struct LoginBody {
        access_token: String,
    }

    async fn create_test_app() -> (Router, crate::db::DbPool) {
        let db_path = std::env::temp_dir().join(format!("navix-sync-e2e-{}.db", Uuid::new_v4()));
        let db_url = format!("sqlite:{}", db_path.to_string_lossy());
        let pool = establish_connection(&db_url).await.expect("init test db");

        let state = Arc::new(AppState {
            server_instance_uuid: Uuid::new_v4(),
            sync_session_manager: SessionManager::new(),
            pool: pool.clone(),
        });

        let protected = Router::new()
            .nest("/api/v1", protected_api_v1_protected())
            .route_layer(middleware::from_fn_with_state(
                Arc::clone(&state),
                jwt::user_auth_layer,
            ))
            .with_state(Arc::clone(&state));

        let admin_protected = Router::new()
            .nest("/api/v1", protected_admin_api_v1())
            .route_layer(middleware::from_fn_with_state(
                Arc::clone(&state),
                jwt::user_auth_layer,
            ))
            .with_state(Arc::clone(&state));

        let app = Router::new()
            .nest("/api", public_api_router().with_state(Arc::clone(&state)))
            .nest("/api", state_api_router().with_state(Arc::clone(&state)))
            .merge(protected)
            .merge(admin_protected)
            .layer(middleware::from_fn(request_telemetry_layer));

        (app, pool)
    }

    async fn get_json(app: &Router, path: &str, token: Option<&str>) -> (StatusCode, Value) {
        let mut req = Request::builder()
            .method("GET")
            .uri(path)
            .header("user-agent", "navix-test-client/1.0");
        if let Some(t) = token {
            req = req.header("authorization", format!("Bearer {t}"));
        }
        let req = req.body(Body::empty()).expect("build request");
        let mut req = req;
        req.extensions_mut()
            .insert(ConnectInfo(SocketAddr::from((Ipv4Addr::LOCALHOST, 18080))));
        let resp = app.clone().oneshot(req).await.expect("call router");
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX)
            .await
            .expect("read body");
        let value: Value = serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            let raw = String::from_utf8_lossy(&bytes);
            panic!(
                "parse json failed for path={path}, status={}, err={e}, raw={raw}",
                status
            );
        });
        (status, value)
    }

    async fn post_json(
        app: &Router,
        path: &str,
        body: Value,
        token: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json")
            .header("user-agent", "navix-test-client/1.0");
        if let Some(t) = token {
            req = req.header("authorization", format!("Bearer {t}"));
        }
        let req = req
            .body(Body::from(body.to_string()))
            .expect("build request");
        let mut req = req;
        req.extensions_mut()
            .insert(ConnectInfo(SocketAddr::from((Ipv4Addr::LOCALHOST, 18080))));
        let resp = app.clone().oneshot(req).await.expect("call router");
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX)
            .await
            .expect("read body");
        let value: Value = serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            let raw = String::from_utf8_lossy(&bytes);
            panic!(
                "parse json failed for path={path}, status={}, err={e}, raw={raw}",
                status
            );
        });
        (status, value)
    }

    async fn bootstrap_admin(app: &Router, username: &str, password: &str) {
        let (_status, resp) = post_json(
            app,
            "/api/bootstrap/init",
            json!({ "username": username, "password": password }),
            None,
        )
        .await;
        assert_eq!(resp["success"], true, "bootstrap should succeed");
    }

    async fn create_user_as_admin(app: &Router, token: &str, username: &str, password: &str) {
        let (status, resp) = post_json(
            app,
            "/api/v1/admin/users",
            json!({ "username": username, "password": password }),
            Some(token),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "admin create user status");
        assert_eq!(resp["success"], true, "admin create user should succeed");
    }

    async fn login_user(app: &Router, username: &str, password: &str) -> String {
        let (status, resp) = post_json(
            app,
            "/api/login",
            json!({ "username": username, "password": password }),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "login http status");
        let data: LoginBody = serde_json::from_value(resp).expect("parse login data");
        data.access_token
    }

    async fn seed_user(pool: &crate::db::DbPool, username: &str, password: &str, role: &str) {
        let hash = bcrypt::hash(password, bcrypt::DEFAULT_COST).expect("hash password");
        let normalized = username.trim().to_lowercase();
        sqlx::query(
            r#"
            INSERT INTO users (uuid, username, username_normalized, password_hash, role)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(username)
        .bind(normalized)
        .bind(hash)
        .bind(role)
        .execute(pool)
        .await
        .expect("insert admin");
    }

    async fn user_uuid_by_name(pool: &crate::db::DbPool, username: &str) -> String {
        sqlx::query_scalar::<_, String>("SELECT uuid FROM users WHERE username = ?1")
            .bind(username)
            .fetch_one(pool)
            .await
            .expect("query user uuid")
    }

    #[tokio::test]
    async fn sync_chunk_rejects_cross_user_session() {
        let (app, pool) = create_test_app().await;
        bootstrap_admin(&app, "owner", "pwd123").await;
        let admin_token = login_user(&app, "owner", "pwd123").await;
        create_user_as_admin(&app, &admin_token, "sync_u1", "pwd123").await;
        create_user_as_admin(&app, &admin_token, "sync_u2", "pwd123").await;

        let token_u1 = login_user(&app, "sync_u1", "pwd123").await;
        let token_u2 = login_user(&app, "sync_u2", "pwd123").await;
        let u1_uuid = user_uuid_by_name(&pool, "sync_u1").await;

        let (_start_status, start_resp) = post_json(
            &app,
            "/api/v1/sync/start",
            json!({ "user_uuid": u1_uuid, "last_synced_rev": 0 }),
            Some(&token_u1),
        )
        .await;
        assert_eq!(start_resp["success"], true, "start sync should succeed");
        let session_id = start_resp["data"]["session_id"]
            .as_str()
            .expect("session_id")
            .to_string();

        let chunk_data = json!(["icon-a.png"]);
        let (status_cross, cross_resp) = post_json(
            &app,
            "/api/v1/sync/chunk",
            json!({
                "session_id": session_id,
                "data_type": "LocalIcons",
                "chunk_index": 0,
                "total_chunks": 1,
                "chunk_checksum": chunk_data.to_string(),
                "chunk_data": chunk_data
            }),
            Some(&token_u2),
        )
        .await;

        assert_eq!(status_cross, StatusCode::BAD_REQUEST);
        assert_eq!(cross_resp["success"], false);
        assert_eq!(cross_resp["code"], "SYNC.SESSION_INVALID");
    }

    #[tokio::test]
    async fn sync_start_returns_server_instance_uuid() {
        let (app, pool) = create_test_app().await;
        bootstrap_admin(&app, "owner", "pwd123").await;
        let admin_token = login_user(&app, "owner", "pwd123").await;
        create_user_as_admin(&app, &admin_token, "sync_uuid", "pwd123").await;
        let token = login_user(&app, "sync_uuid", "pwd123").await;
        let user_uuid = user_uuid_by_name(&pool, "sync_uuid").await;

        let (status, start_resp) = post_json(
            &app,
            "/api/v1/sync/start",
            json!({ "user_uuid": user_uuid, "last_synced_rev": 0 }),
            Some(&token),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        let server_instance_uuid = start_resp["data"]["server_instance_uuid"]
            .as_str()
            .expect("server_instance_uuid");
        assert!(Uuid::parse_str(server_instance_uuid).is_ok());
    }

    #[tokio::test]
    async fn welcome_rejects_token_from_other_server_instance() {
        let (app_a, _pool_a) = create_test_app().await;
        let (app_b, _pool_b) = create_test_app().await;
        bootstrap_admin(&app_a, "issuer_guard", "pwd123").await;
        let token = login_user(&app_a, "issuer_guard", "pwd123").await;

        let (status, resp) = get_json(&app_b, "/api/v1/welcome", Some(&token)).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(resp["success"], false);
        assert_eq!(resp["code"], "AUTH.TOKEN_INVALID");
    }

    #[tokio::test]
    async fn sync_complete_is_retryable_after_incomplete_chunks() {
        let (app, pool) = create_test_app().await;
        bootstrap_admin(&app, "owner", "pwd123").await;
        let admin_token = login_user(&app, "owner", "pwd123").await;
        create_user_as_admin(&app, &admin_token, "sync_retry", "pwd123").await;
        let token = login_user(&app, "sync_retry", "pwd123").await;
        let user_uuid = user_uuid_by_name(&pool, "sync_retry").await;

        let (_start_status, start_resp) = post_json(
            &app,
            "/api/v1/sync/start",
            json!({ "user_uuid": user_uuid, "last_synced_rev": 0 }),
            Some(&token),
        )
        .await;
        let session_id = start_resp["data"]["session_id"]
            .as_str()
            .expect("session_id")
            .to_string();

        let first_chunk = json!(["icon-1.png"]);
        let (_chunk_status, chunk_resp) = post_json(
            &app,
            "/api/v1/sync/chunk",
            json!({
                "session_id": session_id,
                "data_type": "LocalIcons",
                "chunk_index": 0,
                "total_chunks": 2,
                "chunk_checksum": first_chunk.to_string(),
                "chunk_data": first_chunk
            }),
            Some(&token),
        )
        .await;
        assert_eq!(chunk_resp["success"], true);

        let (complete_fail_status, complete_fail_resp) = post_json(
            &app,
            "/api/v1/sync/complete",
            json!({ "session_id": session_id }),
            Some(&token),
        )
        .await;
        assert_eq!(complete_fail_status, StatusCode::BAD_REQUEST);
        assert_eq!(complete_fail_resp["code"], "SYNC.SESSION_INVALID");

        let second_chunk = json!(["icon-2.png"]);
        let (_chunk2_status, chunk2_resp) = post_json(
            &app,
            "/api/v1/sync/chunk",
            json!({
                "session_id": session_id,
                "data_type": "LocalIcons",
                "chunk_index": 1,
                "total_chunks": 2,
                "chunk_checksum": second_chunk.to_string(),
                "chunk_data": second_chunk
            }),
            Some(&token),
        )
        .await;
        assert_eq!(chunk2_resp["success"], true);

        let (complete_ok_status, complete_ok_resp) = post_json(
            &app,
            "/api/v1/sync/complete",
            json!({ "session_id": session_id }),
            Some(&token),
        )
        .await;
        assert_eq!(complete_ok_status, StatusCode::OK);
        assert_eq!(complete_ok_resp["success"], true);
    }

    #[tokio::test]
    async fn sync_chunk_accepts_checksum_with_different_object_key_order() {
        let (app, pool) = create_test_app().await;
        bootstrap_admin(&app, "owner", "pwd123").await;
        let admin_token = login_user(&app, "owner", "pwd123").await;
        create_user_as_admin(&app, &admin_token, "sync_checksum_order", "pwd123").await;
        let token = login_user(&app, "sync_checksum_order", "pwd123").await;
        let user_uuid = user_uuid_by_name(&pool, "sync_checksum_order").await;

        let (_start_status, start_resp) = post_json(
            &app,
            "/api/v1/sync/start",
            json!({ "user_uuid": user_uuid, "last_synced_rev": 0 }),
            Some(&token),
        )
        .await;
        let session_id = start_resp["data"]["session_id"]
            .as_str()
            .expect("session_id")
            .to_string();

        let chunk_data = json!([{ "a": 1, "z": 2 }]);
        let chunk_checksum = r#"[{"z":2,"a":1}]"#;
        let (status, resp) = post_json(
            &app,
            "/api/v1/sync/chunk",
            json!({
                "session_id": session_id,
                "data_type": "LocalIcons",
                "chunk_index": 0,
                "total_chunks": 1,
                "chunk_checksum": chunk_checksum,
                "chunk_data": chunk_data
            }),
            Some(&token),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(resp["success"], true);
    }

    #[tokio::test]
    async fn admin_user_token_can_access_user_routes() {
        let (app, pool) = create_test_app().await;
        seed_user(
            &pool,
            "root_admin",
            "pwd123",
            crate::models::user::ROLE_ADMIN,
        )
        .await;

        let admin_token = login_user(&app, "root_admin", "pwd123").await;
        let (status, resp) = get_json(&app, "/api/v1/auth/status", Some(&admin_token)).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(resp["success"], true);
    }

    #[tokio::test]
    async fn user_token_cannot_access_admin_routes() {
        let (app, _pool) = create_test_app().await;
        bootstrap_admin(&app, "owner", "pwd123").await;
        let admin_token = login_user(&app, "owner", "pwd123").await;
        create_user_as_admin(&app, &admin_token, "plain_user", "pwd123").await;
        let user_token = login_user(&app, "plain_user", "pwd123").await;

        let (status, resp) = get_json(&app, "/api/v1/admin/users", Some(&user_token)).await;

        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(resp["success"], false);
        assert_eq!(resp["code"], "RESOURCE.FORBIDDEN");
    }

    #[tokio::test]
    async fn bootstrap_admin_can_access_admin_routes() {
        let (app, _pool) = create_test_app().await;
        bootstrap_admin(&app, "owner", "pwd123").await;
        let token = login_user(&app, "owner", "pwd123").await;

        let (status, resp) = get_json(&app, "/api/v1/admin/users", Some(&token)).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(resp["success"], true);
    }

    #[tokio::test]
    async fn telemetry_headers_are_propagated_and_generated() {
        let (app, _pool) = create_test_app().await;

        let req = Request::builder()
            .method("GET")
            .uri("/api/version")
            .header(TRACE_ID_HEADER, "trace-from-client")
            .body(Body::empty())
            .expect("build request");
        let mut req = req;
        req.extensions_mut()
            .insert(ConnectInfo(SocketAddr::from((Ipv4Addr::LOCALHOST, 18080))));

        let resp = app.clone().oneshot(req).await.expect("call router");
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = to_bytes(resp.into_body(), usize::MAX)
            .await
            .expect("read body");
        let json: Value = serde_json::from_slice(&bytes).expect("parse json");
        assert_eq!(json["trace_id"], "trace-from-client");

        let req = Request::builder()
            .method("GET")
            .uri("/api/version")
            .header(TRACE_ID_HEADER, "trace-from-client")
            .body(Body::empty())
            .expect("build request");
        let mut req = req;
        req.extensions_mut()
            .insert(ConnectInfo(SocketAddr::from((Ipv4Addr::LOCALHOST, 18080))));
        let resp = app.clone().oneshot(req).await.expect("call router");
        let trace_id = resp
            .headers()
            .get(TRACE_ID_HEADER)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let request_id = resp
            .headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert_eq!(trace_id, "trace-from-client");
        assert!(!request_id.is_empty(), "request id should be generated");

        let req2 = Request::builder()
            .method("GET")
            .uri("/api/version")
            .body(Body::empty())
            .expect("build request");
        let mut req2 = req2;
        req2.extensions_mut()
            .insert(ConnectInfo(SocketAddr::from((Ipv4Addr::LOCALHOST, 18081))));
        let resp2 = app.clone().oneshot(req2).await.expect("call router");
        let generated_trace = resp2
            .headers()
            .get(TRACE_ID_HEADER)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let generated_request_id = resp2
            .headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(!generated_trace.is_empty(), "trace id should be generated");
        assert!(
            !generated_request_id.is_empty(),
            "request id should be generated"
        );
    }
}
