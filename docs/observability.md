# Navix 可观测性规范

## 概述

本文档定义 Navix 项目的统一可观测性约定，适用于 `apps/server`、`apps/client`、`apps/server/web` 以及相关共享模块。运行期 telemetry 的接入细则见 [Telemetry / 日志规范](./telemetry-logging-spec.md)。

目标是让日志、埋点与链路上下文保持一致，便于排障、质量分析与运行状态观察。

## 设计原则

- 统一事件命名、字段结构与脱敏规则。
- 共享模块负责契约与通用工具，应用层负责运行时接入。
- 事件应具备明确语义，并能关联到请求、会话或用户上下文。
- 默认只采集必要信息，避免记录敏感原文。

## 事件命名

事件名称统一使用小写点分段格式，推荐 `domain.object.action` 或 `domain.action.result`。

示例：

- `auth.login.started`
- `auth.login.succeeded`
- `auth.login.failed`
- `sync.session.started`
- `sync.session.completed`
- `api.request.completed`

命名约束：

- 同一事件名只表达一个稳定语义。
- 使用清晰、可读的英文单词，避免缩写和近义重复。
- 结果状态优先体现在事件名或结构化字段中，不使用临时字符串约定。

## 统一字段

### 核心字段

建议所有正式事件包含以下字段：

- `event_name`：事件名称
- `timestamp`：UTC 时间，ISO 8601 格式
- `level`：日志等级
- `source.layer`：事件来源层，如 `server`、`client`、`web`
- `source.app`：应用标识
- `source.app_version`：应用版本
- `context.trace_id`：跨端链路追踪 ID
- `context.session_id`：会话标识
- `result.status`：执行结果，如 `success`、`fail`、`timeout`

### 推荐字段

按场景补充以下字段：

- `context.request_id`
- `context.route`
- `actor.user_uuid`
- `actor.role`
- `metrics.latency_ms`
- `result.error_code`
- `result.error_message`

### 字段约束

- 标识类字段统一使用字符串类型。
- `payload` 仅承载补充业务上下文，不替代顶层语义字段。
- `error_message` 不应包含敏感信息或原始密钥内容。
- 耗时、大小等数值字段使用明确单位后缀，如 `*_ms`、`*_bytes`。

## 链路追踪

为支持跨端排障，客户端与服务端应围绕以下字段建立关联：

- `trace_id`：全链路追踪主键
- `request_id`：单次请求标识
- `session_id`：会话维度标识

接入建议：

- 请求发起方生成或继承 `trace_id`。
- HTTP 请求头透传 `x-trace-id`。
- 服务端在请求处理与响应阶段保持相同链路标识。
- 关键失败事件至少包含 `event_name`、`timestamp`、`trace_id`。

## 日志等级

推荐使用以下等级：

- `DEBUG`：开发调试信息
- `INFO`：正常业务事件
- `WARN`：可恢复异常、降级或重试
- `ERROR`：用户可感知失败或关键流程失败
- `FATAL`：进程级不可恢复错误

## 隐私与安全

默认不得记录以下敏感内容原文：

- `token`
- `refresh_token`
- `password`
- `authorization`
- `cookie`

补充约束：

- 邮箱、手机号、地址等个人信息应避免直接进入日志。
- 必要时优先记录稳定标识或脱敏值，而不是原始输入。
- 用户输入内容、认证信息和密钥不得直接拼接到错误消息中。

## 各端接入

### Shared

- 共享类型、契约与日志工具放在 `packages/shared-rs`、`packages/shared-ts`。
- 共享层负责事件结构、字段定义与通用工具，避免各应用重复定义模型。

### Server

- 服务端负责请求上下文注入、结构化输出和错误码映射。
- 业务日志应复用统一结构，不单独维护另一套格式。

### client 与 Web

- 客户端负责在请求、同步、关键交互和错误场景中补齐上下文。
- 前端事件应通过共享日志工具输出，避免分散的自定义格式。

## 事件治理

新增事件时建议遵循以下流程：

1. 先确认现有事件中是否已覆盖同一语义。
2. 使用统一命名格式定义事件名称。
3. 明确事件用途、触发时机和所需字段。
4. 检查是否包含敏感信息与冗余字段。
5. 补充示例与责任模块，便于后续维护。

## 事件示例

```json
{
  "event_name": "sync.session.failed",
  "timestamp": "2026-03-20T10:15:00.000Z",
  "level": "ERROR",
  "source": {
    "layer": "server",
    "app": "navix-server",
    "app_version": "0.1.0"
  },
  "context": {
    "trace_id": "3f6f2f2ccf2e43a5a2f6c2e2f66a91c4",
    "request_id": "req_9f2c",
    "session_id": "s_abc"
  },
  "result": {
    "status": "fail",
    "error_code": "SYNC_TIMEOUT",
    "error_message": "sync task exceeded timeout threshold"
  },
  "metrics": {
    "latency_ms": 12005
  },
  "payload": {
    "operation": "incremental_sync"
  }
}
```
