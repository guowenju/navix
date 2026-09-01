use crate::db::DbPool;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Refresh Token 的生命周期，例如 180 天。
const REFRESH_TOKEN_LIFETIME_DAYS: i64 = 180;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RefreshToken {
    pub id: i64,
    pub user_uuid: String,
    pub token: String,
    pub expires_at: String,
    pub device_info: Option<String>,
    pub ip_address: Option<String>,
    pub last_used_at: String,
    pub created_at: String,
    pub updated_at: String,
}

impl RefreshToken {
    /// 异步创建并存储一个新的 Refresh Token
    pub async fn create(
        pool: &DbPool,
        user_uuid: String,
        device_info: Option<String>,
        ip_address: Option<String>,
    ) -> Result<String, sqlx::Error> {
        let token = Uuid::new_v4().to_string();

        // let expires_at = DateTime::parse_from_rfc3339(&expires_at)
        //     .expect("数据库中的时间格式应为 RFC3339")
        //     .with_timezone(&Utc);
        //
        // let is_expired = Utc::now() >= expires_at;
        let expires_at = (Utc::now() + Duration::days(REFRESH_TOKEN_LIFETIME_DAYS))
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();

        // last_used_at 字段应设置为当前时间，数据库默认为 created_at
        let last_used_at = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

        sqlx::query(
            r#"
            INSERT INTO refresh_tokens (
                user_uuid, token, expires_at, device_info, ip_address, last_used_at
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(&user_uuid)
        .bind(&token)
        .bind(&expires_at)
        .bind(&device_info)
        .bind(&ip_address)
        .bind(&last_used_at)
        .execute(pool)
        .await?;

        Ok(token)
    }

    /// 创建 Refresh Token 前先删除该用户的所有 Refresh Token
    pub async fn delete_all_by_user_uuid(
        pool: &DbPool,
        user_uuid: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            DELETE FROM refresh_tokens
            WHERE user_uuid = $1
            "#,
        )
        .bind(user_uuid)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// 异步查找并返回有效的 Refresh Token
    pub async fn find_valid_by_token(
        pool: &DbPool,
        token: &str,
    ) -> Result<Option<Self>, sqlx::Error> {
        let current_time = Utc::now().to_rfc3339();

        let token = sqlx::query_as::<_, Self>(
            r#"
            SELECT id, user_uuid, token, expires_at, created_at, device_info, ip_address, last_used_at, updated_at
            FROM refresh_tokens
            WHERE token = $1 AND expires_at > $2
            "#,
        )
        .bind(token)
        .bind(current_time)
        .fetch_optional(pool)
        .await?;

        Ok(token)
    }

    /// 异步撤销 (删除) 指定的 Refresh Token
    pub async fn revoke_token(pool: &DbPool, token: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            DELETE FROM refresh_tokens
            WHERE token = $1
            "#,
        )
        .bind(token)
        .execute(pool)
        .await?;

        Ok(())
    }
}
