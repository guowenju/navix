# Navix Telemetry / 日志规范

## 目标

Navix 运行期日志统一使用结构化 `TelemetryRecord`，覆盖 `apps/server`、`apps/client`、`apps/server/web` 与共享模块。目标是让请求、同步、认证和前端运行期错误可以通过 `trace_id` 串联排查，并避免敏感字段散落在自由文本日志中。

## 事件命名

事件名统一为小写点分段：

- `api.request.completed`
- `auth.login.started`
- `auth.token.verify.failed`
- `sync.compat.check.passed`
- `sync.session.completed`

禁止在事件名中使用下划线、连字符、冒号、空格或驼峰。复杂流程可以增加中间分段，但同一语义不得重复命名。

## 记录结构

所有正式日志使用 `packages/shared-rs/src/dto/telemetry.rs` 中的 `TelemetryRecord`：

- `schema_version`：当前为 `1.0.0`
- `event_name`：统一事件名
- `event_id`：单条事件 ID
- `timestamp`：UTC ISO 8601
- `level`：`DEBUG / INFO / WARN / ERROR / FATAL`
- `source`：来源层、应用名、版本和环境
- `actor`：用户与角色信息，缺失时为空
- `context`：`session_id`、`trace_id`、`request_id`、路由和平台
- `metrics`：耗时等指标
- `result`：结果状态、错误码和错误消息
- `payload`：业务补充字段

`payload` 不得写入 `ts`、`source`、`level` 等系统字段。

## 接入入口

- Rust 共享构造逻辑位于 `packages/shared-rs/src/telemetry.rs`。
- Server 只通过 `apps/server/src/observability.rs` 输出结构化日志。
- Tauri 宿主只通过 `apps/client/src-tauri/src/modules/telemetry.rs` 构造业务 telemetry，`modules/logger.rs` 只负责初始化 sink。
- 桌面 React 运行期日志通过 `apps/client/src/utils/logger.ts`。
- Web React 运行期日志通过 `apps/server/web/src/utils/logger.ts`。
- `packages/shared-ts/src/telemetry.ts` 提供通用 `createFrontendTelemetryLogger`、`logTelemetry`、`debug/info/warn/error`。

新增业务日志不得直接调用 `console.*` 或直接依赖 `@tauri-apps/plugin-log`，脚本和底层 adapter 除外。

## 脱敏与安全

底层 helper 会对以下键名做兜底脱敏，包含嵌套对象：

- `token`
- `refresh_token`
- `password`
- `authorization`
- `cookie`
- `secret`
- `api_key`

业务侧仍应优先记录摘要字段，例如数量、状态、错误码、耗时和稳定 ID，不记录完整用户输入、认证凭据、Cookie、Token、私钥、完整本地敏感路径或大段响应内容。

## 链路关联

HTTP 调用使用：

- `x-trace-id`：跨端链路 ID
- `x-request-id`：单次请求 ID

客户端发起请求时生成或继承 `trace_id`，服务端 middleware 注入响应头并写回 API JSON 响应。同步、认证和文件上传下载日志应复用同一 `trace_id`。

## 自动检查

根脚本 `pnpm telemetry:check` 会检查：

- 事件名必须是小写点分段。
- 前端运行期源码不得新增 `console.*`。
- 桌面前端不得绕过 logger adapter 直接导入 `@tauri-apps/plugin-log`。
- telemetry payload 不得写入系统字段。
- 明显敏感键不得直接放入 telemetry payload。

`pnpm check` 已包含 `pnpm telemetry:check`。
