# Navix

Navix 是一个以桌面端为核心的 monorepo 项目，当前包含：

- 桌面客户端：基于 Tauri v2、React 19、TypeScript 与本地 SQLite
- 服务端：基于 Rust、Axum、SQLx 与 SQLite
- 网页端：由服务端内嵌分发的静态前端
- 共享模块：前后端共用的类型、契约、工具和 UI 组件

项目目标是围绕“导航入口 + 管理员控制的账号体系 + 多端同步”构建一套聚焦导航功能的完整应用。

## 核心能力

### 桌面端

桌面端位于 `apps/client`，当前主要能力包括：

- 导航面板：网站分组、网站项管理、拖拽排序、WAN/LAN 地址切换、元数据抓取、书签导入、自定义搜索引擎
- 账户体系：匿名用户、多账户切换、登录状态管理、删除账户本地数据
- 数据同步：兼容性校验、分块同步、图标上传下载、同步日志记录
- 应用设置：多语言、主题、开机自启、启动最小化、关闭最小化到托盘、自动更新

桌面端本地数据以用户主目录下的 `~/.vust/navix` 为中心组织，数据库、配置和图标缓存都围绕该目录管理。

### 服务端

服务端位于 `apps/server`，当前主要能力包括：

- 认证与账号：管理员初始化、管理员创建用户、登录、刷新令牌、登录态校验、修改用户名、修改密码
- 同步与兼容性：`/api/compat`、同步会话 `start -> chunk -> complete`、图标上传下载、服务端实例 UUID 校验
- 管理接口：用户列表、启用、禁用、清理、删除
- 观测能力：结构化日志、`trace_id` / `request_id`
- 静态资源分发：将 `apps/server/web/dist` 嵌入服务端二进制并作为前端 fallback 返回

服务端是桌面客户端同步链路中的核心服务，负责账号、导航同步与运行时管理。

## 技术栈

- 桌面宿主：Tauri v2
- 前端：React 19、TypeScript、Vite、Styled Components、Framer Motion
- 服务端：Rust、Axum、SQLx、Tokio
- 数据库：SQLite
- 共享层：`packages/shared-ts`、`packages/shared-ui`、`packages/shared-rs`

## 文档

- [可观测性规范](docs/observability.md)
- [Telemetry / 日志规范](docs/telemetry-logging-spec.md)

## 目录结构

```text
navix/
├── apps/
│   ├── client/             # Tauri 桌面客户端
│   │   ├── src/             # React 界面层
│   │   └── src-tauri/       # Rust 宿主、数据库、invoke、托盘等
│   └── server/              # Rust/Axum 服务端
│       └── web/             # 网页端静态前端
├── packages/
│   ├── shared-rs/           # Rust 共享类型与能力
│   ├── shared-ts/           # TypeScript 共享类型与工具
│   └── shared-ui/           # 共享 UI 组件与主题
├── docs/                    # 项目文档
├── Cargo.toml               # Rust workspace 根配置
├── pnpm-workspace.yaml      # pnpm workspace 根配置
├── package.json             # 根脚本与前端校验命令
├── CHANGELOG.md             # 全项目统一更新日志
└── README.md                # 项目总入口说明
```

## 快速开始

在仓库根目录执行：

```bash
pnpm install
```

### 启动桌面端开发环境

```bash
pnpm tauri dev
```

### 启动网页端开发环境

```bash
pnpm --dir apps/server/web dev
```

### 启动服务端

```bash
pnpm server:dev
```

如果只想直接运行服务端，也可以：

```bash
pnpm --dir apps/server/web web:build
cargo run -p navix-server
```

## Docker 使用

### 直接运行镜像

```bash
docker run -d \
  --name navix-server \
  --restart unless-stopped \
  -p 9990:9990 \
  -v navix-data:/data \
  sfwwslm/navix-server:latest
```

说明：

- 数据库位于 `/data/database/navix-server.db`
- 服务端实例标识文件位于 `/data/server_instance.uuid`
- 图标文件位于 `/data/storage/user_icons`

如需启用 HTTPS，请同时暴露 `9991` 端口，并挂载证书目录：

```bash
docker run -d \
  --name navix-server \
  --restart unless-stopped \
  -p 9990:9990 \
  -p 9991:9991 \
  -v navix-data:/data \
  -v /path/to/certs:/certs:ro \
  sfwwslm/navix-server:latest \
  --enable-https \
  --cert-path /certs/fullchain.pem \
  --key-path /certs/privkey.pem
```

### Docker Compose 示例

```yaml
services:
  navix-server:
    image: sfwwslm/navix-server:latest
    container_name: navix-server
    restart: unless-stopped
    ports:
      - "9990:9990"
      # - "9991:9991"
    volumes:
      - ./data:/data
      # - /path/to/certs:/certs:ro
    # command: >
    #   --enable-https
    #   --cert-path /certs/fullchain.pem
    #   --key-path /certs/privkey.pem
```

## 常用命令

### 前端相关

```bash
pnpm format
pnpm check
```

### 全仓校验

```bash
pnpm format:all
pnpm check:all
```

### Rust 相关

```bash
cargo fmt
cargo clippy
cargo test --workspace
```

## 文档索引

- [CHANGELOG.md](https://github.com/sfwwslm/navix/blob/main/CHANGELOG.md)
- [客户端文档](https://github.com/sfwwslm/navix/blob/main/docs/client-app.md)
- [服务端文档](https://github.com/sfwwslm/navix/blob/main/docs/server.md)
- [可观测性文档](https://github.com/sfwwslm/navix/blob/main/docs/observability.md)
