//! 导航数据读取与管理服务。

use crate::config::STORAGE_BASE_DIR;
use crate::db::DbPool;
use crate::error::{ApiError, ApiResult};
use crate::models::website::{
    CreateWebsitePayload, DEFAULT_WEBSITE_ICON, NavigationGroup, NavigationWebsite,
    UpdateWebsitePayload, WebsiteGroupDto, WebsiteIconAction, WebsitesDto,
};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tokio::fs;
use uuid::Uuid;

/// Web 端单个站点图标允许的最大体积（5 MiB）。
pub const WEBSITE_ICON_MAX_BYTES: usize = 5 * 1024 * 1024;

/// 已通过内容与扩展名校验、可以安全落盘的站点图标。
#[derive(Debug)]
pub struct ValidatedWebsiteIcon {
    pub bytes: Vec<u8>,
    pub extension: &'static str,
}

/// 获取指定用户的导航数据，只返回未删除的分组和网站。
pub async fn fetch_navigation_for_user(
    pool: &DbPool,
    user_uuid: &str,
) -> Result<Vec<NavigationGroup>, sqlx::Error> {
    let groups = sqlx::query_as::<_, WebsiteGroupDto>(
        r#"
        SELECT uuid, name, description, sort_order, is_deleted, rev, updated_at
        FROM website_groups
        WHERE user_uuid = ?1 AND is_deleted = 0
        ORDER BY sort_order IS NULL, sort_order ASC, updated_at DESC
        "#,
    )
    .bind(user_uuid)
    .fetch_all(pool)
    .await?;

    let websites = sqlx::query_as::<_, WebsitesDto>(
        r#"
        SELECT uuid, group_uuid, title, url, url_lan, default_icon, local_icon_path, background_color, description, sort_order, is_deleted, rev, updated_at
        FROM websites
        WHERE user_uuid = ?1 AND is_deleted = 0
        ORDER BY sort_order IS NULL, sort_order ASC, updated_at DESC
        "#,
    )
    .bind(user_uuid)
    .fetch_all(pool)
    .await?;

    let mut grouped: HashMap<String, NavigationGroup> = groups
        .into_iter()
        .map(|group| {
            (
                group.uuid.clone(),
                NavigationGroup {
                    uuid: group.uuid,
                    name: group.name,
                    description: group.description,
                    sort_order: group.sort_order,
                    websites: Vec::new(),
                },
            )
        })
        .collect();

    for site in websites {
        if let Some(group) = grouped.get_mut(&site.group_uuid) {
            group.websites.push(NavigationWebsite {
                uuid: site.uuid,
                group_uuid: site.group_uuid,
                title: site.title,
                url: site.url,
                url_lan: site.url_lan,
                default_icon: site.default_icon,
                local_icon_path: site.local_icon_path,
                background_color: site.background_color,
                description: site.description,
                sort_order: site.sort_order,
            });
        }
    }

    let mut groups: Vec<NavigationGroup> = grouped.into_values().collect();

    // 对每个分组内的网站进行排序
    for group in groups.iter_mut() {
        group.websites.sort_by(|a, b| {
            compare_sort_then_title(a.sort_order, b.sort_order, &a.title, &b.title)
        });
    }

    // 最终的分组排序
    groups.sort_by(|a, b| compare_sort_then_title(a.sort_order, b.sort_order, &a.name, &b.name));

    Ok(groups)
}

/// 校验上传图标的扩展名、文件签名和 SVG 主动内容。
pub fn validate_website_icon(file_name: &str, bytes: Vec<u8>) -> ApiResult<ValidatedWebsiteIcon> {
    if bytes.is_empty() {
        return Err(ApiError::BadRequest(
            "Icon file must not be empty".to_string(),
        ));
    }
    if bytes.len() > WEBSITE_ICON_MAX_BYTES {
        return Err(ApiError::BadRequest(
            "Icon file must not exceed 5 MiB".to_string(),
        ));
    }

    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| ApiError::BadRequest("Icon file has no valid extension".to_string()))?;

    let normalized_extension = match extension.as_str() {
        "png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => "png",
        "jpg" | "jpeg" if bytes.starts_with(&[0xff, 0xd8, 0xff]) => "jpg",
        "webp" if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" => {
            "webp"
        }
        "gif" if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") => "gif",
        "ico" if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) => "ico",
        "svg" => {
            validate_svg(&bytes)?;
            "svg"
        }
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "ico" => {
            return Err(ApiError::BadRequest(
                "Icon file content does not match its extension".to_string(),
            ));
        }
        _ => {
            return Err(ApiError::BadRequest(
                "Only PNG, JPG, WebP, GIF, ICO, and SVG icons are supported".to_string(),
            ));
        }
    };

    Ok(ValidatedWebsiteIcon {
        bytes,
        extension: normalized_extension,
    })
}

/// 对 SVG 做基础格式检查，并拒绝明显的脚本内容。
fn validate_svg(bytes: &[u8]) -> ApiResult<()> {
    let svg = std::str::from_utf8(bytes)
        .map_err(|_| ApiError::BadRequest("SVG icon must use UTF-8 encoding".to_string()))?;
    let lower = svg.to_ascii_lowercase();
    let trimmed = lower.trim_start_matches('\u{feff}').trim_start();
    let root = if trimmed.starts_with("<?xml") {
        trimmed
            .find("?>")
            .map(|index| trimmed[index + 2..].trim_start())
            .ok_or_else(|| ApiError::BadRequest("SVG XML declaration is incomplete".to_string()))?
    } else {
        trimmed
    };

    let has_svg_root = root.strip_prefix("<svg").is_some_and(|remaining| {
        remaining
            .chars()
            .next()
            .is_some_and(|character| character == '>' || character.is_whitespace())
    });
    if !has_svg_root {
        return Err(ApiError::BadRequest(
            "SVG file is missing an svg root element".to_string(),
        ));
    }

    if lower.contains("<script") || lower.contains("javascript:") {
        return Err(ApiError::BadRequest(
            "SVG icon contains unsafe script content".to_string(),
        ));
    }

    Ok(())
}

/// 验证目标分组属于当前用户且仍有效。
async fn ensure_group_owner(pool: &DbPool, user_uuid: &str, group_uuid: &str) -> ApiResult<()> {
    let target_group = sqlx::query_scalar::<_, String>(
        r#"
        SELECT uuid
        FROM website_groups
        WHERE uuid = ?1 AND user_uuid = ?2 AND is_deleted = 0
        LIMIT 1
        "#,
    )
    .bind(group_uuid)
    .bind(user_uuid)
    .fetch_optional(pool)
    .await?;

    if target_group.is_none() {
        return Err(ApiError::ResourceNotFound);
    }
    Ok(())
}

/// 将站点图标写入当前用户的专属目录，并返回数据库保存的安全文件名。
async fn write_website_icon(
    user_uuid: &str,
    website_uuid: &str,
    icon: &ValidatedWebsiteIcon,
) -> ApiResult<String> {
    let user_icon_dir = PathBuf::from(STORAGE_BASE_DIR).join(user_uuid);
    fs::create_dir_all(&user_icon_dir).await?;
    let file_name = format!("{website_uuid}-{}.{}", Uuid::new_v4(), icon.extension);
    let final_path = user_icon_dir.join(&file_name);
    let temporary_path = user_icon_dir.join(format!(".{file_name}.tmp"));

    fs::write(&temporary_path, &icon.bytes).await?;
    if let Err(error) = fs::rename(&temporary_path, &final_path).await {
        let _ = fs::remove_file(&temporary_path).await;
        return Err(error.into());
    }
    Ok(file_name)
}

/// 删除没有被任何有效站点或搜索引擎继续引用的图标文件。
async fn remove_icon_if_unreferenced(
    pool: &DbPool,
    user_uuid: &str,
    file_name: &str,
) -> ApiResult<()> {
    let reference_count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT
            (SELECT COUNT(*) FROM websites
             WHERE user_uuid = ?1 AND local_icon_path = ?2 AND is_deleted = 0)
          + (SELECT COUNT(*) FROM search_engines
             WHERE user_uuid = ?1 AND local_icon_path = ?2 AND is_deleted = 0)
        "#,
    )
    .bind(user_uuid)
    .bind(file_name)
    .fetch_one(pool)
    .await?;

    if reference_count == 0 {
        let path = PathBuf::from(STORAGE_BASE_DIR)
            .join(user_uuid)
            .join(file_name);
        match fs::remove_file(path).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

/// 创建当前用户的新站点，并可同时绑定用户上传图标。
pub async fn create_website_for_user(
    pool: &DbPool,
    user_uuid: &str,
    payload: &CreateWebsitePayload,
    icon: Option<&ValidatedWebsiteIcon>,
) -> ApiResult<NavigationWebsite> {
    ensure_group_owner(pool, user_uuid, &payload.group_uuid).await?;

    let website_uuid = Uuid::new_v4().to_string();
    let local_icon_path = match icon {
        Some(icon) => Some(write_website_icon(user_uuid, &website_uuid, icon).await?),
        None => None,
    };
    let icon_source = local_icon_path.as_ref().map(|_| "user_uploaded");
    let url_lan = normalize_optional(payload.url_lan.as_ref());
    let description = normalize_optional(payload.description.as_ref());
    let background_color = normalize_optional(payload.background_color.as_ref());

    let insert_result = sqlx::query(
        r#"
        INSERT INTO websites (
            uuid, user_uuid, group_uuid, title, url, url_lan, default_icon,
            local_icon_path, icon_source, description, background_color
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
    )
    .bind(&website_uuid)
    .bind(user_uuid)
    .bind(&payload.group_uuid)
    .bind(payload.title.trim())
    .bind(payload.url.trim())
    .bind(&url_lan)
    .bind(DEFAULT_WEBSITE_ICON)
    .bind(&local_icon_path)
    .bind(icon_source)
    .bind(&description)
    .bind(&background_color)
    .execute(pool)
    .await;

    if let Err(error) = insert_result {
        if let Some(file_name) = &local_icon_path {
            let _ = fs::remove_file(
                PathBuf::from(STORAGE_BASE_DIR)
                    .join(user_uuid)
                    .join(file_name),
            )
            .await;
        }
        return Err(error.into());
    }

    Ok(NavigationWebsite {
        uuid: website_uuid,
        group_uuid: payload.group_uuid.clone(),
        title: payload.title.trim().to_string(),
        url: payload.url.trim().to_string(),
        url_lan,
        default_icon: Some(DEFAULT_WEBSITE_ICON.to_string()),
        local_icon_path,
        background_color,
        description,
        sort_order: None,
    })
}

/// 将可选文本统一裁剪，并把空字符串归一化为空值。
fn normalize_optional(value: Option<&String>) -> Option<String> {
    value
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

/// 更新当前用户的站点配置。
pub async fn update_website_for_user(
    pool: &DbPool,
    user_uuid: &str,
    website_uuid: &str,
    payload: &UpdateWebsitePayload,
    icon: Option<&ValidatedWebsiteIcon>,
) -> ApiResult<()> {
    // 先验证站点属于当前用户，再继续后续更新，避免用 rows_affected
    // 同时承担“资源不存在”和“越权访问”两种语义判定。
    let existing = sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>)>(
        r#"
        SELECT local_icon_path, default_icon, icon_source
        FROM websites
        WHERE uuid = ?1 AND user_uuid = ?2 AND is_deleted = 0
        LIMIT 1
        "#,
    )
    .bind(website_uuid)
    .bind(user_uuid)
    .fetch_optional(pool)
    .await?;

    let Some((previous_icon_path, previous_default_icon, previous_icon_source)) = existing else {
        return Err(ApiError::ResourceNotFound);
    };
    ensure_group_owner(pool, user_uuid, &payload.group_uuid).await?;

    if icon.is_some() && payload.icon_action == WebsiteIconAction::Reset {
        return Err(ApiError::BadRequest(
            "Cannot upload an icon and reset to the default icon at the same time".to_string(),
        ));
    }

    // 表单中的可选文本在服务层统一归一化，数据库只保存真实值。
    let url_lan = normalize_optional(payload.url_lan.as_ref());
    let submitted_default_icon = payload
        .default_icon
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let description = normalize_optional(payload.description.as_ref());
    let background_color = normalize_optional(payload.background_color.as_ref());

    let new_icon_path = match icon {
        Some(icon) => Some(write_website_icon(user_uuid, website_uuid, icon).await?),
        None => None,
    };
    let (local_icon_path, default_icon, icon_source) = if let Some(path) = &new_icon_path {
        (
            Some(path.clone()),
            submitted_default_icon.or_else(|| Some(DEFAULT_WEBSITE_ICON.to_string())),
            Some("user_uploaded".to_string()),
        )
    } else if payload.icon_action == WebsiteIconAction::Reset {
        (None, Some(DEFAULT_WEBSITE_ICON.to_string()), None)
    } else {
        (
            previous_icon_path.clone(),
            submitted_default_icon.or(previous_default_icon),
            previous_icon_source,
        )
    };

    let update_result = sqlx::query(
        r#"
        UPDATE websites
        SET group_uuid = ?1,
            title = ?2,
            url = ?3,
            url_lan = ?4,
            default_icon = ?5,
            local_icon_path = ?6,
            icon_source = ?7,
            description = ?8,
            background_color = ?9
        WHERE uuid = ?10 AND user_uuid = ?11 AND is_deleted = 0
        "#,
    )
    .bind(&payload.group_uuid)
    .bind(payload.title.trim())
    .bind(payload.url.trim())
    .bind(url_lan)
    .bind(default_icon)
    .bind(&local_icon_path)
    .bind(&icon_source)
    .bind(&description)
    .bind(&background_color)
    .bind(website_uuid)
    .bind(user_uuid)
    .execute(pool)
    .await;

    if let Err(error) = update_result {
        if let Some(file_name) = &new_icon_path {
            let _ = fs::remove_file(
                PathBuf::from(STORAGE_BASE_DIR)
                    .join(user_uuid)
                    .join(file_name),
            )
            .await;
        }
        return Err(error.into());
    }

    if previous_icon_path != local_icon_path
        && let Some(previous_file_name) = previous_icon_path
        && let Err(error) = remove_icon_if_unreferenced(pool, user_uuid, &previous_file_name).await
    {
        tracing::warn!(
            user_uuid,
            website_uuid,
            file_name = previous_file_name,
            error = ?error,
            "Website was updated, but the old icon could not be removed"
        );
    }

    Ok(())
}

/// 原子更新当前用户指定分组内的完整站点顺序。
pub async fn reorder_websites_for_user(
    pool: &DbPool,
    user_uuid: &str,
    group_uuid: &str,
    item_uuids: &[String],
) -> ApiResult<()> {
    let mut transaction = pool.begin().await?;
    let group_exists = sqlx::query_scalar::<_, String>(
        r#"
        SELECT uuid
        FROM website_groups
        WHERE uuid = ?1 AND user_uuid = ?2 AND is_deleted = 0
        LIMIT 1
        "#,
    )
    .bind(group_uuid)
    .bind(user_uuid)
    .fetch_optional(transaction.as_mut())
    .await?;
    if group_exists.is_none() {
        return Err(ApiError::ResourceNotFound);
    }

    let active_items_by_uuid = sqlx::query_as::<_, (String, Option<i64>)>(
        r#"
        SELECT uuid, sort_order
        FROM websites
        WHERE group_uuid = ?1 AND user_uuid = ?2 AND is_deleted = 0
        "#,
    )
    .bind(group_uuid)
    .bind(user_uuid)
    .fetch_all(transaction.as_mut())
    .await?
    .into_iter()
    .collect::<HashMap<_, _>>();

    let submitted_items = item_uuids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let active_items = active_items_by_uuid
        .keys()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    if submitted_items.len() != item_uuids.len() || submitted_items != active_items {
        return Err(ApiError::BadRequest(
            "Item order must contain every active website in the target group exactly once"
                .to_string(),
        ));
    }

    for (index, item_uuid) in item_uuids.iter().enumerate() {
        let desired_sort_order = index as i64 + 1;
        if active_items_by_uuid.get(item_uuid) == Some(&Some(desired_sort_order)) {
            continue;
        }

        let result = sqlx::query(
            r#"
            UPDATE websites
            SET sort_order = ?1
            WHERE uuid = ?2 AND group_uuid = ?3 AND user_uuid = ?4 AND is_deleted = 0
            "#,
        )
        .bind(desired_sort_order)
        .bind(item_uuid)
        .bind(group_uuid)
        .bind(user_uuid)
        .execute(transaction.as_mut())
        .await?;
        if result.rows_affected() != 1 {
            return Err(ApiError::BadRequest(
                "Website order changed while the request was being processed".to_string(),
            ));
        }
    }

    transaction.commit().await?;
    Ok(())
}

/// 删除当前用户的站点。
pub async fn delete_website_for_user(
    pool: &DbPool,
    user_uuid: &str,
    website_uuid: &str,
) -> ApiResult<()> {
    // 删除同样绑定当前用户，避免不同账号之间通过 uuid 互删数据。
    // 同步协议依赖 is_deleted tombstone 向客户端传播删除状态，因此这里不能物理删除。
    let result = sqlx::query(
        r#"
        UPDATE websites
        SET is_deleted = 1
        WHERE uuid = ?1 AND user_uuid = ?2 AND is_deleted = 0
        "#,
    )
    .bind(website_uuid)
    .bind(user_uuid)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::ResourceNotFound);
    }

    Ok(())
}

/// 辅助排序：先按 sort_order，空值排在最后；再按标题字母排序。
fn compare_sort_then_title(
    a_sort: Option<i64>,
    b_sort: Option<i64>,
    a_title: &str,
    b_title: &str,
) -> Ordering {
    match (a_sort, b_sort) {
        (Some(a), Some(b)) => a
            .cmp(&b)
            .then_with(|| a_title.to_lowercase().cmp(&b_title.to_lowercase())),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => a_title.to_lowercase().cmp(&b_title.to_lowercase()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        WEBSITE_ICON_MAX_BYTES, create_website_for_user, reorder_websites_for_user,
        update_website_for_user, validate_website_icon,
    };
    use crate::config::STORAGE_BASE_DIR;
    use crate::error::ApiError;
    use crate::models::website::{
        CreateWebsitePayload, DEFAULT_WEBSITE_ICON, UpdateWebsitePayload, WebsiteIconAction,
    };
    use sqlx::SqlitePool;
    use std::path::PathBuf;
    use tokio::fs;
    use uuid::Uuid;

    async fn create_test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            r#"
            CREATE TABLE website_groups (
                uuid TEXT PRIMARY KEY,
                user_uuid TEXT NOT NULL,
                is_deleted INTEGER NOT NULL DEFAULT 0
            )
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"
            CREATE TABLE websites (
                uuid TEXT PRIMARY KEY,
                user_uuid TEXT NOT NULL,
                group_uuid TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                url_lan TEXT,
                default_icon TEXT,
                local_icon_path TEXT,
                icon_source TEXT,
                description TEXT,
                background_color TEXT,
                sort_order INTEGER,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                rev INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT 'initial'
            )
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"
            CREATE TRIGGER set_test_websites_updated_at
            AFTER UPDATE OF sort_order ON websites FOR EACH ROW
            BEGIN
                UPDATE websites
                SET rev = OLD.rev + 1, updated_at = 'changed'
                WHERE uuid = OLD.uuid;
            END
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"
            CREATE TABLE search_engines (
                user_uuid TEXT NOT NULL,
                local_icon_path TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0
            )
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    fn create_payload(group_uuid: &str) -> CreateWebsitePayload {
        CreateWebsitePayload {
            title: "Navix".to_string(),
            url: "https://example.com".to_string(),
            url_lan: None,
            group_uuid: group_uuid.to_string(),
            description: None,
            background_color: None,
        }
    }

    fn update_payload(group_uuid: &str, icon_action: WebsiteIconAction) -> UpdateWebsitePayload {
        UpdateWebsitePayload {
            title: "Navix updated".to_string(),
            url: "https://example.com/updated".to_string(),
            url_lan: None,
            group_uuid: group_uuid.to_string(),
            default_icon: Some(DEFAULT_WEBSITE_ICON.to_string()),
            description: None,
            background_color: None,
            icon_action,
        }
    }

    async fn insert_site(pool: &SqlitePool, user_uuid: &str, group_uuid: &str, site_uuid: &str) {
        sqlx::query("INSERT INTO website_groups (uuid, user_uuid) VALUES (?1, ?2)")
            .bind(group_uuid)
            .bind(user_uuid)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            r#"
            INSERT INTO websites (
                uuid, user_uuid, group_uuid, title, url, default_icon
            ) VALUES (?1, ?2, ?3, 'Navix', 'https://example.com', ?4)
            "#,
        )
        .bind(site_uuid)
        .bind(user_uuid)
        .bind(group_uuid)
        .bind(DEFAULT_WEBSITE_ICON)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_ordered_sites(
        pool: &SqlitePool,
        user_uuid: &str,
        group_uuid: &str,
        sites: &[(&str, i64)],
    ) {
        sqlx::query("INSERT INTO website_groups (uuid, user_uuid) VALUES (?1, ?2)")
            .bind(group_uuid)
            .bind(user_uuid)
            .execute(pool)
            .await
            .unwrap();
        for (site_uuid, sort_order) in sites {
            sqlx::query(
                r#"
                INSERT INTO websites (
                    uuid, user_uuid, group_uuid, title, url, default_icon, sort_order
                ) VALUES (?1, ?2, ?3, ?1, 'https://example.com', ?4, ?5)
                "#,
            )
            .bind(site_uuid)
            .bind(user_uuid)
            .bind(group_uuid)
            .bind(DEFAULT_WEBSITE_ICON)
            .bind(sort_order)
            .execute(pool)
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn create_site_uses_default_icon() {
        let pool = create_test_pool().await;
        sqlx::query("INSERT INTO website_groups (uuid, user_uuid) VALUES ('group-a', 'user-a')")
            .execute(&pool)
            .await
            .unwrap();

        let created = create_website_for_user(&pool, "user-a", &create_payload("group-a"), None)
            .await
            .unwrap();

        assert_eq!(created.default_icon.as_deref(), Some(DEFAULT_WEBSITE_ICON));
        assert!(created.local_icon_path.is_none());
        let stored_icon: Option<String> =
            sqlx::query_scalar("SELECT default_icon FROM websites WHERE uuid = ?1")
                .bind(&created.uuid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored_icon.as_deref(), Some(DEFAULT_WEBSITE_ICON));
    }

    #[tokio::test]
    async fn create_site_rejects_group_owned_by_another_user() {
        let pool = create_test_pool().await;
        sqlx::query("INSERT INTO website_groups (uuid, user_uuid) VALUES ('group-a', 'user-b')")
            .execute(&pool)
            .await
            .unwrap();

        let error = create_website_for_user(&pool, "user-a", &create_payload("group-a"), None)
            .await
            .unwrap_err();
        assert!(matches!(error, ApiError::ResourceNotFound));
    }

    #[tokio::test]
    async fn reorders_every_site_in_group() {
        let pool = create_test_pool().await;
        insert_ordered_sites(
            &pool,
            "user-a",
            "group-a",
            &[("site-a", 1), ("site-b", 2), ("site-c", 3)],
        )
        .await;

        reorder_websites_for_user(
            &pool,
            "user-a",
            "group-a",
            &["site-c".into(), "site-a".into(), "site-b".into()],
        )
        .await
        .unwrap();

        let ordered: Vec<String> = sqlx::query_scalar(
            "SELECT uuid FROM websites WHERE group_uuid = 'group-a' ORDER BY sort_order",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(ordered, ["site-c", "site-a", "site-b"]);
    }

    #[tokio::test]
    async fn reorder_only_updates_sites_whose_position_changed() {
        let pool = create_test_pool().await;
        insert_ordered_sites(
            &pool,
            "user-a",
            "group-a",
            &[("site-a", 1), ("site-b", 2), ("site-c", 3), ("site-d", 4)],
        )
        .await;
        let reordered = [
            "site-a".into(),
            "site-c".into(),
            "site-b".into(),
            "site-d".into(),
        ];

        reorder_websites_for_user(&pool, "user-a", "group-a", &reordered)
            .await
            .unwrap();
        reorder_websites_for_user(&pool, "user-a", "group-a", &reordered)
            .await
            .unwrap();

        let versions: Vec<(String, i64, String)> = sqlx::query_as(
            r#"
            SELECT uuid, rev, updated_at
            FROM websites
            WHERE group_uuid = 'group-a'
            ORDER BY uuid
            "#,
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            versions,
            [
                ("site-a".into(), 0, "initial".into()),
                ("site-b".into(), 1, "changed".into()),
                ("site-c".into(), 1, "changed".into()),
                ("site-d".into(), 0, "initial".into()),
            ]
        );
    }

    #[tokio::test]
    async fn reorder_rejects_group_owned_by_another_user() {
        let pool = create_test_pool().await;
        insert_ordered_sites(&pool, "user-b", "group-a", &[("site-a", 1)]).await;

        let error = reorder_websites_for_user(&pool, "user-a", "group-a", &["site-a".into()])
            .await
            .unwrap_err();
        assert!(matches!(error, ApiError::ResourceNotFound));
    }

    #[tokio::test]
    async fn reorder_rejects_incomplete_duplicate_extra_and_cross_group_items() {
        for submitted in [
            vec!["site-a".into()],
            vec!["site-a".into(), "site-a".into()],
            vec!["site-a".into(), "site-b".into(), "missing".into()],
            vec!["site-a".into(), "site-c".into()],
        ] {
            let pool = create_test_pool().await;
            insert_ordered_sites(&pool, "user-a", "group-a", &[("site-a", 1), ("site-b", 2)]).await;
            if submitted.iter().any(|uuid| uuid == "site-c") {
                insert_ordered_sites(&pool, "user-a", "group-b", &[("site-c", 1)]).await;
            }

            let error = reorder_websites_for_user(&pool, "user-a", "group-a", &submitted)
                .await
                .unwrap_err();
            assert!(matches!(error, ApiError::BadRequest(_)));
        }
    }

    #[tokio::test]
    async fn reorder_rolls_back_when_an_update_fails() {
        let pool = create_test_pool().await;
        insert_ordered_sites(&pool, "user-a", "group-a", &[("site-a", 2), ("site-b", 1)]).await;
        sqlx::query(
            r#"
            CREATE TRIGGER fail_second_order_update
            BEFORE UPDATE OF sort_order ON websites
            WHEN NEW.uuid = 'site-b'
            BEGIN
                SELECT RAISE(FAIL, 'forced');
            END
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = reorder_websites_for_user(
            &pool,
            "user-a",
            "group-a",
            &["site-a".into(), "site-b".into()],
        )
        .await;
        assert!(result.is_err());

        let orders: Vec<(String, i64)> = sqlx::query_as(
            "SELECT uuid, sort_order FROM websites WHERE group_uuid = 'group-a' ORDER BY uuid",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(orders, [("site-a".into(), 2), ("site-b".into(), 1)]);
    }

    #[tokio::test]
    async fn update_site_replaces_and_resets_uploaded_icon() {
        let pool = create_test_pool().await;
        let user_uuid = Uuid::new_v4().to_string();
        let group_uuid = Uuid::new_v4().to_string();
        let site_uuid = Uuid::new_v4().to_string();
        insert_site(&pool, &user_uuid, &group_uuid, &site_uuid).await;
        let icon = validate_website_icon("icon.png", b"\x89PNG\r\n\x1a\nrest".to_vec()).unwrap();

        update_website_for_user(
            &pool,
            &user_uuid,
            &site_uuid,
            &update_payload(&group_uuid, WebsiteIconAction::Keep),
            Some(&icon),
        )
        .await
        .unwrap();

        let uploaded_name: Option<String> =
            sqlx::query_scalar("SELECT local_icon_path FROM websites WHERE uuid = ?1")
                .bind(&site_uuid)
                .fetch_one(&pool)
                .await
                .unwrap();
        let uploaded_name = uploaded_name.unwrap();
        let uploaded_path = PathBuf::from(STORAGE_BASE_DIR)
            .join(&user_uuid)
            .join(&uploaded_name);
        assert!(uploaded_path.exists());

        update_website_for_user(
            &pool,
            &user_uuid,
            &site_uuid,
            &update_payload(&group_uuid, WebsiteIconAction::Reset),
            None,
        )
        .await
        .unwrap();

        let (local_icon_path, default_icon): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT local_icon_path, default_icon FROM websites WHERE uuid = ?1")
                .bind(&site_uuid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(local_icon_path.is_none());
        assert_eq!(default_icon.as_deref(), Some(DEFAULT_WEBSITE_ICON));
        assert!(!uploaded_path.exists());
        let _ = fs::remove_dir(PathBuf::from(STORAGE_BASE_DIR).join(&user_uuid)).await;
    }

    #[tokio::test]
    async fn update_failure_cleans_new_icon_file() {
        let pool = create_test_pool().await;
        let user_uuid = Uuid::new_v4().to_string();
        let group_uuid = Uuid::new_v4().to_string();
        let site_uuid = Uuid::new_v4().to_string();
        insert_site(&pool, &user_uuid, &group_uuid, &site_uuid).await;
        sqlx::query(
            "CREATE TRIGGER fail_site_update BEFORE UPDATE ON websites BEGIN SELECT RAISE(FAIL, 'forced'); END",
        )
        .execute(&pool)
        .await
        .unwrap();
        let icon = validate_website_icon("icon.png", b"\x89PNG\r\n\x1a\nrest".to_vec()).unwrap();

        let result = update_website_for_user(
            &pool,
            &user_uuid,
            &site_uuid,
            &update_payload(&group_uuid, WebsiteIconAction::Keep),
            Some(&icon),
        )
        .await;
        assert!(result.is_err());

        let user_icon_dir = PathBuf::from(STORAGE_BASE_DIR).join(&user_uuid);
        let remaining_files = match fs::read_dir(&user_icon_dir).await {
            Ok(mut entries) => entries.next_entry().await.unwrap().is_some(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => panic!("Failed to read the test icon directory: {error}"),
        };
        assert!(!remaining_files);
        let _ = fs::remove_dir(user_icon_dir).await;
    }

    #[test]
    fn accepts_supported_image_signatures() {
        let cases = [
            ("icon.png", b"\x89PNG\r\n\x1a\nrest".as_slice()),
            ("icon.jpg", &[0xff, 0xd8, 0xff, 0x00]),
            ("icon.gif", b"GIF89arest".as_slice()),
            ("icon.ico", &[0x00, 0x00, 0x01, 0x00, 0x01]),
            ("icon.webp", b"RIFF0000WEBPrest".as_slice()),
            (
                "icon.svg",
                br#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>"#.as_slice(),
            ),
        ];

        for (file_name, bytes) in cases {
            assert!(validate_website_icon(file_name, bytes.to_vec()).is_ok());
        }
    }

    #[test]
    fn rejects_oversized_or_mismatched_images() {
        assert!(validate_website_icon("icon.png", vec![0; WEBSITE_ICON_MAX_BYTES + 1]).is_err());
        assert!(validate_website_icon("icon.png", b"GIF89a".to_vec()).is_err());
    }

    #[test]
    fn rejects_svg_scripts() {
        for svg in [
            br#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"#
                .as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"/></svg>"#
                .as_slice(),
        ] {
            assert!(validate_website_icon("icon.svg", svg.to_vec()).is_err());
        }
    }

    #[test]
    fn accepts_svg_events_and_external_resources() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" onload="ready()"><image href="https://example.com/icon.png"/></svg>"#;
        assert!(validate_website_icon("icon.svg", svg.to_vec()).is_ok());
    }
}
