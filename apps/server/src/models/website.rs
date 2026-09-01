use serde::{Deserialize, Serialize};
use shared_rs::dto::api::ValidationDetails;
pub use shared_rs::dto::sync::{WebsiteGroupDto, WebsitesDto};
use url::Url;

/// Web 端新建站点时使用的默认 Iconify 图标。
pub const DEFAULT_WEBSITE_ICON: &str = "ion:globe-outline";

/// 网站分组结构体，对应数据库中的 `website_groups` 表
#[derive(Debug, sqlx::FromRow, Serialize, Deserialize)]
pub struct WebsiteGroupEntity {
    pub id: i64,
    pub uuid: String,
    pub user_uuid: String,
    pub name: String,
    pub description: Option<String>,
    pub sort_order: Option<i64>,
    pub is_deleted: i64,
    pub rev: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// 网站结构体，对应数据库中的 `website_items` 表
#[derive(Debug, sqlx::FromRow, Serialize, Deserialize)]
pub struct WebsiteEntity {
    pub id: i64,
    pub uuid: String,
    pub user_uuid: String,
    pub group_uuid: String,
    pub title: String,
    pub url: String,
    pub url_lan: Option<String>,
    pub default_icon: Option<String>,
    pub local_icon_path: Option<String>,
    pub description: Option<String>,
    pub background_color: Option<String>,
    pub sort_order: Option<i64>,
    pub is_deleted: i64,
    pub rev: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// 用于导航展示的简化网站数据
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NavigationWebsite {
    pub uuid: String,
    pub group_uuid: String,
    pub title: String,
    pub url: String,
    pub url_lan: Option<String>,
    pub default_icon: Option<String>,
    pub local_icon_path: Option<String>,
    pub background_color: Option<String>,
    pub description: Option<String>,
    pub sort_order: Option<i64>,
}

/// 用于导航展示的分组数据（包含网站列表）
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NavigationGroup {
    pub uuid: String,
    pub name: String,
    pub description: Option<String>,
    pub sort_order: Option<i64>,
    pub websites: Vec<NavigationWebsite>,
}

/// Web 端创建导航站点时提交的请求体。
#[derive(Debug, Deserialize)]
pub struct CreateWebsitePayload {
    pub title: String,
    pub url: String,
    pub url_lan: Option<String>,
    pub group_uuid: String,
    pub description: Option<String>,
    pub background_color: Option<String>,
}

/// Web 端编辑站点时对已有本地图标执行的动作。
#[derive(Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WebsiteIconAction {
    /// 保留当前图标；如果 multipart 同时携带图标文件，则替换为新文件。
    #[default]
    Keep,
    /// 清除当前本地图标并恢复默认图标。
    Reset,
}

/// Web 端更新导航站点时提交的请求体。
#[derive(Debug, Deserialize)]
pub struct UpdateWebsitePayload {
    pub title: String,
    pub url: String,
    pub url_lan: Option<String>,
    pub group_uuid: String,
    pub default_icon: Option<String>,
    pub description: Option<String>,
    pub background_color: Option<String>,
    #[serde(default)]
    pub icon_action: WebsiteIconAction,
}

/// 校验创建和更新站点共用的基础字段。
fn validate_website_fields(
    title: &str,
    url: &str,
    url_lan: Option<&String>,
    group_uuid: &str,
) -> ValidationDetails {
    let mut details = ValidationDetails::new();

    if title.trim().is_empty() {
        details.insert(
            "title".to_string(),
            vec!["VALIDATION.TITLE_REQUIRED".to_string()],
        );
    }

    if url.trim().is_empty() {
        details.insert(
            "url".to_string(),
            vec!["VALIDATION.URL_REQUIRED".to_string()],
        );
    } else if !looks_like_http_url(url) {
        details.insert(
            "url".to_string(),
            vec!["VALIDATION.URL_INVALID".to_string()],
        );
    }

    if let Some(url_lan) = url_lan
        && !url_lan.trim().is_empty()
        && !looks_like_http_url(url_lan)
    {
        details.insert(
            "url_lan".to_string(),
            vec!["VALIDATION.URL_LAN_INVALID".to_string()],
        );
    }

    if group_uuid.trim().is_empty() {
        details.insert(
            "group_uuid".to_string(),
            vec!["VALIDATION.GROUP_UUID_REQUIRED".to_string()],
        );
    }

    details
}

impl CreateWebsitePayload {
    /// 执行字段级校验并返回稳定校验码集合。
    pub fn validate_fields(&self) -> ValidationDetails {
        validate_website_fields(
            &self.title,
            &self.url,
            self.url_lan.as_ref(),
            &self.group_uuid,
        )
    }
}

impl UpdateWebsitePayload {
    /// 执行字段级校验并返回稳定校验码集合。
    pub fn validate_fields(&self) -> ValidationDetails {
        validate_website_fields(
            &self.title,
            &self.url,
            self.url_lan.as_ref(),
            &self.group_uuid,
        )
    }
}

/// 判断 URL 是否为包含有效主机名的 HTTP/HTTPS 地址。
fn looks_like_http_url(value: &str) -> bool {
    let value = value.trim();
    let Some((scheme, authority_and_path)) = value.split_once("://") else {
        return false;
    };
    if !matches!(scheme, "http" | "https")
        || authority_and_path.is_empty()
        || authority_and_path.starts_with('/')
    {
        return false;
    }

    Url::parse(value)
        .ok()
        .is_some_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
}

#[cfg(test)]
mod tests {
    use super::looks_like_http_url;

    #[test]
    fn validates_complete_http_urls() {
        for url in [
            "https://example.com",
            "http://localhost:3000/path",
            "http://192.168.1.10",
        ] {
            assert!(looks_like_http_url(url));
        }
    }

    #[test]
    fn rejects_incomplete_or_unsupported_urls() {
        for url in [
            "https://",
            "http:///missing-host",
            "ftp://example.com",
            "example.com",
        ] {
            assert!(!looks_like_http_url(url));
        }
    }
}
