-- Web 专用分组锁定配置，不属于客户端/服务端同步共享结构。
CREATE TABLE IF NOT EXISTS launchpad_lock_settings (
    user_uuid TEXT PRIMARY KEY NOT NULL,
    password_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (user_uuid) REFERENCES users (uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS launchpad_group_locks (
    user_uuid TEXT NOT NULL,
    group_uuid TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (user_uuid, group_uuid),
    FOREIGN KEY (user_uuid) REFERENCES users (uuid) ON DELETE CASCADE,
    FOREIGN KEY (group_uuid) REFERENCES website_groups (uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_launchpad_group_locks_group
ON launchpad_group_locks (group_uuid);
