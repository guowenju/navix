//! 导航数据读取与管理服务。

use crate::db::DbPool;
use crate::error::{ApiError, ApiResult};
use crate::models::website::{
    NavigationGroup, NavigationWebsite, UpdateWebsitePayload, WebsiteGroupDto, WebsitesDto,
};
use std::cmp::Ordering;
use std::collections::HashMap;

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

/// 更新当前用户的站点配置。
pub async fn update_website_for_user(
    pool: &DbPool,
    user_uuid: &str,
    website_uuid: &str,
    payload: &UpdateWebsitePayload,
) -> ApiResult<()> {
    // 先验证站点属于当前用户，再继续后续更新，避免用 rows_affected
    // 同时承担“资源不存在”和“越权访问”两种语义判定。
    let existing = sqlx::query_scalar::<_, String>(
        r#"
        SELECT uuid
        FROM websites
        WHERE uuid = ?1 AND user_uuid = ?2 AND is_deleted = 0
        LIMIT 1
        "#,
    )
    .bind(website_uuid)
    .bind(user_uuid)
    .fetch_optional(pool)
    .await?;

    if existing.is_none() {
        return Err(ApiError::ResourceNotFound);
    }

    let target_group = sqlx::query_scalar::<_, String>(
        r#"
        SELECT uuid
        FROM website_groups
        WHERE uuid = ?1 AND user_uuid = ?2 AND is_deleted = 0
        LIMIT 1
        "#,
    )
    .bind(&payload.group_uuid)
    .bind(user_uuid)
    .fetch_optional(pool)
    .await?;

    if target_group.is_none() {
        return Err(ApiError::ResourceNotFound);
    }

    // Web 编辑弹窗当前没有暴露图标/背景色字段，空字符串会在这里归一化为 None，
    // 从而保持数据库里只存真实值，不保留无意义空串。
    let url_lan = payload
        .url_lan
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let default_icon = payload
        .default_icon
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let description = payload
        .description
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let background_color = payload
        .background_color
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    sqlx::query(
        r#"
        UPDATE websites
        SET group_uuid = ?1,
            title = ?2,
            url = ?3,
            url_lan = ?4,
            default_icon = ?5,
            description = ?6,
            background_color = ?7
        WHERE uuid = ?8 AND user_uuid = ?9 AND is_deleted = 0
        "#,
    )
    .bind(&payload.group_uuid)
    .bind(payload.title.trim())
    .bind(payload.url.trim())
    .bind(url_lan)
    .bind(default_icon)
    .bind(description)
    .bind(background_color)
    .bind(website_uuid)
    .bind(user_uuid)
    .execute(pool)
    .await?;

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
