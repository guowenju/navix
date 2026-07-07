use crate::api::routes::jwt::Claims;
use crate::config::STORAGE_BASE_DIR;
use crate::db::DbPool;
use crate::db::TableName;
use crate::db::sync_sql::{
    get_group_uuid_by_name, group_exists, query_record_status_by_uuid, record_exists_by_uuid,
    search_engine_name_exists_for_user, website_group_name_exists_for_user,
};
use crate::models::search_engine::SearchEngineDto;
use crate::models::sync::{ClientSyncData, ServerSyncData, SyncDataDto};
use crate::models::website::{WebsiteGroupDto, WebsitesDto};
use anyhow::Result;
use chrono::{DateTime, SecondsFormat, Utc};
use sqlx::{Sqlite, Transaction};
use std::collections::HashSet;
use std::path::PathBuf;
use tokio::fs;
use tracing::{debug, error, info};

/// 在一个事务中处理导航与搜索引擎同步。
pub async fn process_data_sync(
    pool: &DbPool,
    claims: Claims,
    payload: ClientSyncData,
) -> Result<ServerSyncData> {
    if claims.sub != payload.user_uuid {
        error!(
            "接口中发送的user_uuid: {} 与token中: {} 不一致！",
            payload.user_uuid, claims.sub
        );
        return Err(anyhow::anyhow!("非法的用户！"));
    }
    let mut tx = pool.begin().await?;

    let website_groups_count = process_website_groups(
        &mut tx,
        &payload.user_uuid,
        payload.last_synced_rev,
        &payload.sync_data.website_groups,
    )
    .await?;
    info!("{website_groups_count} 个网站分组已处理完毕！");

    let websites_count = process_websites(
        &mut tx,
        &payload.user_uuid,
        payload.last_synced_rev,
        &payload.sync_data.websites,
        &payload.sync_data.website_groups,
    )
    .await?;
    info!("{websites_count} 个站点数据已处理完毕！");

    let search_engines_count = process_search_engines(
        &mut tx,
        &payload.user_uuid,
        payload.last_synced_rev,
        &payload.sync_data.search_engines,
    )
    .await?;
    info!("{search_engines_count} 个搜索引擎已处理完毕！");

    info!("开始查找需要增量同步的数据...");
    let sync_data =
        fetch_records_after_client_rev(&mut tx, &payload.user_uuid, payload.last_synced_rev)
            .await?;

    let (icons_to_upload, icons_to_download) =
        calculate_icon_diffs(&mut tx, &payload.user_uuid, &payload.local_icons).await?;

    tx.commit().await?;

    let now: DateTime<Utc> = Utc::now();
    let current_synced_at = now.to_rfc3339_opts(SecondsFormat::Millis, true);
    let current_synced_rev = now.timestamp_millis();
    Ok(ServerSyncData {
        current_synced_rev,
        current_synced_at,
        sync_data,
        icons_to_upload,
        icons_to_download,
        website_groups_count,
        websites_count,
        search_engines_count,
    })
}

async fn fetch_records_after_client_rev(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    user_uuid: &str,
    last_sync_rev: i64,
) -> Result<SyncDataDto> {
    let website_groups_sql = format!(
        "SELECT uuid, name, description, sort_order, is_deleted, rev, updated_at FROM {} WHERE rev > ? AND user_uuid = ?",
        TableName::WebsiteGroups
    );
    let website_groups: Vec<WebsiteGroupDto> = sqlx::query_as(&website_groups_sql)
        .bind(last_sync_rev)
        .bind(user_uuid)
        .fetch_all(&mut **tx)
        .await?;
    info!("{:?} 个网站分组需要增量同步！", website_groups.len());

    let websites_sql = format!(
        "SELECT uuid, group_uuid, title, url, url_lan, default_icon, local_icon_path, background_color, description, sort_order, is_deleted, rev, updated_at FROM {} WHERE rev > ? AND user_uuid = ?",
        TableName::Websites
    );
    let websites: Vec<WebsitesDto> = sqlx::query_as(&websites_sql)
        .bind(last_sync_rev)
        .bind(user_uuid)
        .fetch_all(&mut **tx)
        .await?;
    info!("{:?} 个站点需要增量同步！", websites.len());

    let search_engines_sql = format!(
        "SELECT uuid, name, url_template, default_icon, local_icon_path, is_default, sort_order, is_deleted, rev, updated_at FROM {} WHERE rev > ? AND user_uuid = ?",
        TableName::SearchEngines
    );
    let search_engines: Vec<SearchEngineDto> = sqlx::query_as(&search_engines_sql)
        .bind(last_sync_rev)
        .bind(user_uuid)
        .fetch_all(&mut **tx)
        .await?;
    info!("{:?} 个搜索引擎需要增量同步！", search_engines.len());

    Ok(SyncDataDto {
        website_groups,
        websites,
        search_engines,
    })
}

async fn process_website_groups(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    user_uuid: &str,
    last_synced_rev: i64,
    groups: &[WebsiteGroupDto],
) -> Result<usize> {
    let table_name: String = TableName::WebsiteGroups.to_string();
    info!("开始处理【{table_name}】表的数据...");
    let mut count: usize = 0;
    for group in groups {
        let exists =
            record_exists_by_uuid(tx, &group.uuid, user_uuid, TableName::WebsiteGroups).await?;
        if exists {
            let status =
                query_record_status_by_uuid(tx, &group.uuid, user_uuid, TableName::WebsiteGroups)
                    .await?;
            if status.rev > last_synced_rev {
                debug!(
                    "{} 表中 {} 在客户端上次同步后已被服务器更新（server_rev={}, last_synced_rev={}），跳过客户端更新。",
                    table_name, group.uuid, status.rev, last_synced_rev
                );
            } else if group.rev > status.rev {
                count += update_sync_website_group(tx, user_uuid, group).await?;
            } else {
                debug!(
                    "{} 表中 {} 的服务器 rev({}) 更新领先客户端 rev({})，跳过客户端更新。",
                    table_name, group.uuid, status.rev, group.rev
                );
            }
        } else {
            debug!("{} 表中 {} 数据不存在，插入...", table_name, group.uuid);
            count += insert_sync_website_group(tx, user_uuid, group).await?;
        }
    }
    Ok(count)
}

async fn update_sync_website_group(
    tx: &mut Transaction<'_, Sqlite>,
    user_uuid: &str,
    group: &WebsiteGroupDto,
) -> Result<usize> {
    let table_name = TableName::WebsiteGroups;
    debug!("{} 表中 {} 数据比服务器新，更新...", table_name, group.uuid);
    let sql = format!(
        "UPDATE {table_name} SET name = ?, description = ?, sort_order = ?, is_deleted = ? WHERE uuid = ? AND user_uuid = ?"
    );

    let result = sqlx::query(&sql)
        .bind(&group.name)
        .bind(&group.description)
        .bind(group.sort_order)
        .bind(group.is_deleted)
        .bind(&group.uuid)
        .bind(user_uuid)
        .execute(&mut **tx)
        .await?;
    Ok(result.rows_affected() as usize)
}

async fn insert_sync_website_group(
    tx: &mut Transaction<'_, Sqlite>,
    user_uuid: &str,
    group: &WebsiteGroupDto,
) -> Result<usize> {
    let table_name = TableName::WebsiteGroups;
    let name_exists = website_group_name_exists_for_user(tx, &group.name, user_uuid).await?;
    if name_exists {
        debug!(
            "{} 表中已存在名为 '{}' 的分组，新传入的 UUID {} 将不被插入。将更新服务器端同名分组的时间戳以强制同步。",
            table_name, group.name, group.uuid
        );

        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let touch_sql =
            format!("UPDATE {table_name} SET updated_at = ? WHERE name = ? AND user_uuid = ?");
        sqlx::query(&touch_sql)
            .bind(now)
            .bind(&group.name)
            .bind(user_uuid)
            .execute(&mut **tx)
            .await?;

        Ok(1)
    } else {
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let sql = format!(
            "INSERT INTO {table_name} (uuid, user_uuid, name, description, sort_order, is_deleted, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        );

        let result = sqlx::query(&sql)
            .bind(&group.uuid)
            .bind(user_uuid)
            .bind(&group.name)
            .bind(&group.description)
            .bind(group.sort_order)
            .bind(group.is_deleted)
            .bind(&now)
            .execute(&mut **tx)
            .await?;
        Ok(result.rows_affected() as usize)
    }
}

async fn process_websites(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    user_uuid: &str,
    last_synced_rev: i64,
    websites: &[WebsitesDto],
    groups: &[WebsiteGroupDto],
) -> Result<usize> {
    let table_name: String = TableName::Websites.to_string();
    info!("开始处理【{table_name}】表的数据...");
    let mut count: usize = 0;
    for website in websites {
        let exists =
            record_exists_by_uuid(tx, &website.uuid, user_uuid, TableName::Websites).await?;
        if exists {
            let status =
                query_record_status_by_uuid(tx, &website.uuid, user_uuid, TableName::Websites)
                    .await?;
            if status.rev > last_synced_rev {
                debug!(
                    "{} 表中 {} 在客户端上次同步后已被服务器更新（server_rev={}, last_synced_rev={}），跳过客户端更新。",
                    table_name, website.uuid, status.rev, last_synced_rev
                );
            } else if website.rev > status.rev {
                count += update_sync_website(tx, user_uuid, website).await?;
            } else {
                debug!(
                    "{} 表中 {} 的服务器 rev({}) 更新领先客户端 rev({})，跳过客户端更新。",
                    table_name, website.uuid, status.rev, website.rev
                );
            }
        } else {
            debug!("{} 表中 {} 数据不存在，插入...", table_name, website.uuid);
            count += insert_sync_website(tx, user_uuid, website, groups).await?;
        }
    }
    Ok(count)
}

async fn update_sync_website(
    tx: &mut Transaction<'_, Sqlite>,
    user_uuid: &str,
    website: &WebsitesDto,
) -> Result<usize> {
    let table_name = TableName::Websites;
    debug!(
        "{} 表中 {} 数据比服务器新，更新...",
        table_name, website.uuid
    );
    let sql = format!(
        "UPDATE {table_name} SET group_uuid = ?, title = ?, url = ?, url_lan = ?, default_icon = ?, local_icon_path = ?, background_color = ?, description = ?, sort_order = ?, is_deleted = ? WHERE uuid = ? AND user_uuid = ?",
    );

    let result = sqlx::query(&sql)
        .bind(&website.group_uuid)
        .bind(&website.title)
        .bind(&website.url)
        .bind(&website.url_lan)
        .bind(&website.default_icon)
        .bind(&website.local_icon_path)
        .bind(&website.background_color)
        .bind(&website.description)
        .bind(website.sort_order)
        .bind(website.is_deleted)
        .bind(&website.uuid)
        .bind(user_uuid)
        .execute(&mut **tx)
        .await?;
    Ok(result.rows_affected() as usize)
}

async fn insert_sync_website(
    tx: &mut Transaction<'_, Sqlite>,
    user_uuid: &str,
    website: &WebsitesDto,
    groups: &[WebsiteGroupDto],
) -> Result<usize> {
    let table_name = TableName::Websites;

    let group_uuid_exists = group_exists(tx, user_uuid, &website.group_uuid).await?;
    let final_group_uuid = if group_uuid_exists {
        website.group_uuid.clone()
    } else {
        debug!(
            "网站 {} 所属的分组 UUID {} 在服务器上不存在，将尝试按名称重定向。",
            website.uuid, website.group_uuid
        );

        let group_name = groups
            .iter()
            .find(|g| g.uuid == website.group_uuid)
            .map(|g| g.name.as_str());

        if let Some(name) = group_name {
            match get_group_uuid_by_name(tx, user_uuid, name).await {
                Ok(server_uuid) => {
                    info!(
                        "成功将网站 {} 重定向到服务器分组 '{}' (UUID: {})",
                        website.uuid, name, server_uuid
                    );
                    server_uuid
                }
                Err(e) => {
                    error!(
                        "为网站 {} 重定向分组时发生严重错误：{}。该网站数据将丢失。",
                        website.uuid, e
                    );
                    return Err(anyhow::anyhow!(
                        "无法为网站 {} 找到对应的服务器分组 '{}'",
                        website.uuid,
                        name
                    ));
                }
            }
        } else {
            error!(
                "为网站 {} 重定向分组时，无法在客户端数据中找到其分组名称。该网站数据将丢失。",
                website.uuid
            );
            return Err(anyhow::anyhow!(
                "数据不一致：网站 {} 的分组信息缺失",
                website.uuid
            ));
        }
    };

    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let sql = format!(
        "INSERT INTO {table_name} (uuid, user_uuid, group_uuid, title, url, url_lan, default_icon, local_icon_path, background_color, description, sort_order, is_deleted, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    let result = sqlx::query(&sql)
        .bind(&website.uuid)
        .bind(user_uuid)
        .bind(final_group_uuid)
        .bind(&website.title)
        .bind(&website.url)
        .bind(&website.url_lan)
        .bind(&website.default_icon)
        .bind(&website.local_icon_path)
        .bind(&website.background_color)
        .bind(&website.description)
        .bind(website.sort_order)
        .bind(website.is_deleted)
        .bind(&now)
        .execute(&mut **tx)
        .await?;
    Ok(result.rows_affected() as usize)
}

async fn process_search_engines(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    user_uuid: &str,
    last_synced_rev: i64,
    search_engines: &[SearchEngineDto],
) -> Result<usize> {
    let table_name = TableName::SearchEngines;
    info!("开始处理【{}】表的数据...", table_name);
    let mut count = 0;
    for engine in search_engines {
        let exists = record_exists_by_uuid(tx, &engine.uuid, user_uuid, table_name).await?;
        if exists {
            let status =
                query_record_status_by_uuid(tx, &engine.uuid, user_uuid, table_name).await?;
            if status.rev > last_synced_rev {
                debug!(
                    "{} 表中 {} 在客户端上次同步后已被服务器更新（server_rev={}, last_synced_rev={}），跳过客户端更新。",
                    table_name, engine.uuid, status.rev, last_synced_rev
                );
            } else if engine.rev > status.rev {
                count += update_search_engine(tx, user_uuid, engine).await?;
            }
        } else {
            count += insert_search_engine(tx, user_uuid, engine).await?;
        }
    }
    Ok(count)
}

async fn update_search_engine(
    tx: &mut Transaction<'_, Sqlite>,
    user_uuid: &str,
    engine: &SearchEngineDto,
) -> Result<usize> {
    let table_name = TableName::SearchEngines;
    debug!(
        "{} 表中 {} 数据比服务器新，更新...",
        table_name, engine.uuid
    );
    let sql = format!(
        "UPDATE {table_name} SET name = ?, url_template = ?, default_icon = ?, local_icon_path = ?, is_default = ?, sort_order = ?, is_deleted = ?, updated_at = ? WHERE uuid = ? AND user_uuid = ?"
    );
    let result = sqlx::query(&sql)
        .bind(&engine.name)
        .bind(&engine.url_template)
        .bind(&engine.default_icon)
        .bind(&engine.local_icon_path)
        .bind(engine.is_default)
        .bind(engine.sort_order)
        .bind(engine.is_deleted)
        .bind(&engine.updated_at)
        .bind(&engine.uuid)
        .bind(user_uuid)
        .execute(&mut **tx)
        .await?;
    Ok(result.rows_affected() as usize)
}

async fn insert_search_engine(
    tx: &mut Transaction<'_, Sqlite>,
    user_uuid: &str,
    engine: &SearchEngineDto,
) -> Result<usize> {
    let table_name = TableName::SearchEngines;
    let name_exists = search_engine_name_exists_for_user(tx, &engine.name, user_uuid).await?;
    if name_exists {
        debug!(
            "{} 表中已存在名为 '{}' 的搜索引擎，新传入的 UUID {} 将不被插入。将更新服务器端同名记录的时间戳以强制同步。",
            table_name, engine.name, engine.uuid
        );
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let touch_sql =
            format!("UPDATE {table_name} SET updated_at = ? WHERE name = ? AND user_uuid = ?");
        sqlx::query(&touch_sql)
            .bind(now)
            .bind(&engine.name)
            .bind(user_uuid)
            .execute(&mut **tx)
            .await?;
        Ok(1)
    } else {
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let sql = format!(
            "INSERT INTO {table_name} (uuid, user_uuid, name, url_template, default_icon, local_icon_path, is_default, sort_order, is_deleted, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        let result = sqlx::query(&sql)
            .bind(&engine.uuid)
            .bind(user_uuid)
            .bind(&engine.name)
            .bind(&engine.url_template)
            .bind(&engine.default_icon)
            .bind(&engine.local_icon_path)
            .bind(engine.is_default)
            .bind(engine.sort_order)
            .bind(engine.is_deleted)
            .bind(&now)
            .execute(&mut **tx)
            .await?;
        Ok(result.rows_affected() as usize)
    }
}

async fn calculate_icon_diffs(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    user_uuid: &str,
    client_icons: &[String],
) -> Result<(Vec<String>, Vec<String>)> {
    let final_website_icons_sql = "SELECT DISTINCT local_icon_path FROM websites WHERE user_uuid = ? AND local_icon_path IS NOT NULL AND is_deleted = 0";
    let final_search_engine_icons_sql = "SELECT DISTINCT local_icon_path FROM search_engines WHERE user_uuid = ? AND local_icon_path IS NOT NULL";

    let website_icons: Vec<String> = sqlx::query_scalar(final_website_icons_sql)
        .bind(user_uuid)
        .fetch_all(&mut **tx)
        .await?;
    let search_engine_icons: Vec<String> = sqlx::query_scalar(final_search_engine_icons_sql)
        .bind(user_uuid)
        .fetch_all(&mut **tx)
        .await?;

    let final_required_icons: HashSet<String> = website_icons
        .into_iter()
        .chain(search_engine_icons)
        .collect();

    let server_storage_dir = PathBuf::from(STORAGE_BASE_DIR).join(user_uuid);
    let mut server_physical_icons = HashSet::new();
    if server_storage_dir.exists() {
        let mut entries = fs::read_dir(server_storage_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            if let Some(file_name) = entry.file_name().to_str() {
                server_physical_icons.insert(file_name.to_string());
            }
        }
    }

    let client_icons_set: HashSet<String> = client_icons.iter().cloned().collect();

    let icons_to_upload: Vec<String> = final_required_icons
        .iter()
        .filter(|icon| client_icons_set.contains(*icon) && !server_physical_icons.contains(*icon))
        .cloned()
        .collect();

    let icons_to_download: Vec<String> = final_required_icons
        .iter()
        .filter(|icon| server_physical_icons.contains(*icon) && !client_icons_set.contains(*icon))
        .cloned()
        .collect();

    Ok((icons_to_upload, icons_to_download))
}

#[cfg(test)]
mod tests {
    use super::{fetch_records_after_client_rev, process_website_groups, process_websites};
    use crate::models::website::{WebsiteGroupDto, WebsitesDto};
    use crate::services::navigation_service::delete_website_for_user;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn create_test_pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect in-memory sqlite");

        sqlx::query(
            "CREATE TABLE website_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                user_uuid TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                sort_order INTEGER,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                rev INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )",
        )
        .execute(&pool)
        .await
        .expect("create website_groups");

        sqlx::query(
            "CREATE TABLE websites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                user_uuid TEXT NOT NULL,
                group_uuid TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                url_lan TEXT,
                default_icon TEXT,
                local_icon_path TEXT,
                background_color TEXT,
                description TEXT,
                sort_order INTEGER,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                rev INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )",
        )
        .execute(&pool)
        .await
        .expect("create websites");

        sqlx::query(
            "CREATE TRIGGER set_websites_updated_at
            AFTER UPDATE ON websites FOR EACH ROW
            BEGIN
                UPDATE websites
                SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                    rev = OLD.rev + 1
                WHERE id = OLD.id;
            END",
        )
        .execute(&pool)
        .await
        .expect("create websites update trigger");

        sqlx::query(
            "CREATE TABLE search_engines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                user_uuid TEXT NOT NULL,
                name TEXT NOT NULL,
                url_template TEXT NOT NULL,
                default_icon TEXT,
                local_icon_path TEXT,
                is_default INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                rev INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )",
        )
        .execute(&pool)
        .await
        .expect("create search_engines");

        pool
    }

    async fn seed_website(pool: &sqlx::SqlitePool, user_uuid: &str, website_uuid: &str, rev: i64) {
        sqlx::query(
            "INSERT INTO website_groups (uuid, user_uuid, name, description, sort_order, is_deleted, rev, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind("g-website")
        .bind(user_uuid)
        .bind("Websites")
        .bind(None::<String>)
        .bind(Some(1_i64))
        .bind(0_i64)
        .bind(100_i64)
        .bind("2026-01-01T00:00:00.000Z")
        .execute(pool)
        .await
        .expect("seed website group");

        sqlx::query(
            "INSERT INTO websites (uuid, user_uuid, group_uuid, title, url, url_lan, default_icon, local_icon_path, background_color, description, sort_order, is_deleted, rev, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        )
        .bind(website_uuid)
        .bind(user_uuid)
        .bind("g-website")
        .bind("Server Site")
        .bind("https://server.example")
        .bind(None::<String>)
        .bind(None::<String>)
        .bind(None::<String>)
        .bind(None::<String>)
        .bind(None::<String>)
        .bind(Some(1_i64))
        .bind(0_i64)
        .bind(rev)
        .bind("2026-01-01T00:00:00.000Z")
        .execute(pool)
        .await
        .expect("seed website");
    }

    #[tokio::test]
    async fn website_group_conflict_gate_blocks_client_override_when_server_newer_than_last_sync() {
        let pool = create_test_pool().await;
        sqlx::query(
            "INSERT INTO website_groups (uuid, user_uuid, name, description, sort_order, is_deleted, rev, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind("g-1")
        .bind("u-1")
        .bind("server-name")
        .bind(None::<String>)
        .bind(Some(1_i64))
        .bind(0_i64)
        .bind(200_i64)
        .bind("2026-01-01T00:00:00.000Z")
        .execute(&pool)
        .await
        .expect("seed server row");

        let client_groups = vec![WebsiteGroupDto {
            uuid: "g-1".to_string(),
            name: "client-name".to_string(),
            description: None,
            sort_order: Some(9),
            is_deleted: 0,
            rev: 300,
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
        }];

        let mut tx = pool.begin().await.expect("begin tx");
        let affected = process_website_groups(&mut tx, "u-1", 100, &client_groups)
            .await
            .expect("process website groups");
        tx.commit().await.expect("commit");

        assert_eq!(affected, 0);
        let final_name: String = sqlx::query_scalar(
            "SELECT name FROM website_groups WHERE uuid = ?1 AND user_uuid = ?2",
        )
        .bind("g-1")
        .bind("u-1")
        .fetch_one(&pool)
        .await
        .expect("fetch final name");
        assert_eq!(final_name, "server-name");
    }

    #[tokio::test]
    async fn delete_website_for_user_keeps_tombstone_for_sync() {
        let pool = create_test_pool().await;
        seed_website(&pool, "u-1", "w-1", 200).await;

        delete_website_for_user(&pool, "u-1", "w-1")
            .await
            .expect("delete website");

        let (is_deleted, rev): (i64, i64) = sqlx::query_as(
            "SELECT is_deleted, rev FROM websites WHERE uuid = ?1 AND user_uuid = ?2",
        )
        .bind("w-1")
        .bind("u-1")
        .fetch_one(&pool)
        .await
        .expect("fetch tombstone");

        assert_eq!(is_deleted, 1);
        assert!(rev > 200);
    }

    #[tokio::test]
    async fn website_tombstone_blocks_stale_client_resurrection() {
        let pool = create_test_pool().await;
        seed_website(&pool, "u-1", "w-1", 200).await;
        delete_website_for_user(&pool, "u-1", "w-1")
            .await
            .expect("delete website");

        let client_websites = vec![WebsitesDto {
            uuid: "w-1".to_string(),
            group_uuid: "g-website".to_string(),
            title: "Client Site".to_string(),
            url: "https://client.example".to_string(),
            url_lan: None,
            default_icon: None,
            local_icon_path: None,
            background_color: None,
            description: None,
            sort_order: Some(9),
            is_deleted: 0,
            rev: 500,
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
        }];
        let client_groups = vec![WebsiteGroupDto {
            uuid: "g-website".to_string(),
            name: "Websites".to_string(),
            description: None,
            sort_order: Some(1),
            is_deleted: 0,
            rev: 100,
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
        }];

        let mut tx = pool.begin().await.expect("begin tx");
        let affected = process_websites(&mut tx, "u-1", 200, &client_websites, &client_groups)
            .await
            .expect("process websites");
        tx.commit().await.expect("commit");

        assert_eq!(affected, 0);
        let (title, is_deleted): (String, i64) = sqlx::query_as(
            "SELECT title, is_deleted FROM websites WHERE uuid = ?1 AND user_uuid = ?2",
        )
        .bind("w-1")
        .bind("u-1")
        .fetch_one(&pool)
        .await
        .expect("fetch final website");
        assert_eq!(title, "Server Site");
        assert_eq!(is_deleted, 1);
    }

    #[tokio::test]
    async fn website_tombstone_is_returned_by_incremental_sync() {
        let pool = create_test_pool().await;
        seed_website(&pool, "u-1", "w-1", 200).await;
        delete_website_for_user(&pool, "u-1", "w-1")
            .await
            .expect("delete website");

        let mut tx = pool.begin().await.expect("begin tx");
        let sync_data = fetch_records_after_client_rev(&mut tx, "u-1", 200)
            .await
            .expect("fetch incremental data");
        tx.commit().await.expect("commit");

        assert_eq!(sync_data.websites.len(), 1);
        assert_eq!(sync_data.websites[0].uuid, "w-1");
        assert_eq!(sync_data.websites[0].is_deleted, 1);
    }
}
