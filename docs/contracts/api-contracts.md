# API 契约清单

> Scope: Phase 1 / Task 1.2
> Source: `server.py` at CageLedger `0.5.2c`

## 通用约定

| Item | Contract |
|:-----|:---------|
| Auth | cookie session, `SESSION_COOKIE`, `GET /api/auth/me` 判断当前用户 |
| Error shape | `{ "error": "message" }` |
| List shape | `{ "items": [...], "page": { "limit", "offset", "total", "hasMore" } }` |
| Single item shape | `{ "item": {...} }` |
| Audit merge | 写入接口返回 `auditLogs` 时，前端按增量合并 |
| Permission | admin 全局；room manager 按 `roomIds` 过滤房间、笼位、占用、待进驻任务 |
| Cache | 服务端 cache key 由 scope/filter/actor 组成；写入路径显式失效相关 prefix |

## Auth / Session

| Method | Path | Request | Response | Permission |
|:-------|:-----|:--------|:---------|:-----------|
| POST | `/api/auth/login` | `{ username, password }` | `{ user }` + session cookie | public |
| POST | `/api/auth/logout` | empty | `{ ok: true }` | public |
| GET | `/api/auth/me` | empty | `{ user }` | authenticated |
| GET | `/api/users` | query | `{ users }` | admin |
| POST | `/api/users` | user payload | `{ user }` | admin |
| PUT | `/api/users/{id}` | user payload | `{ user }` | admin |
| DELETE | `/api/users/{id}` | empty | `{ ok: true }` | admin |

## Bootstrap / Infrastructure

| Method | Path | Query / Body | Response | Cache |
|:-------|:-----|:-------------|:---------|:------|
| GET | `/api/bootstrap` | `scope=summary` | rooms/racks summary, dashboard, rules summary | `bootstrap_summary` |
| GET | `/api/bootstrap` | `scope=room&roomId=...` | selected room slots/racks/occupancies/tasks | room scoped |
| GET | `/api/bootstrap` | `scope=full` | full infrastructure and shared lists | short TTL |
| POST | `/api/infrastructure` | rooms/racks/slots/occupancies batch | updated infrastructure payload | invalidates bootstrap + billing occupancies |
| GET | `/api/infrastructure/occupancies` | `month`, `iacuc`, `pi` | billing-oriented slots/occupancies | `billing_occupancies` |

## Intake / Placement

| Method | Path | Request | Response | Notes |
|:-------|:-----|:--------|:---------|:------|
| GET | `/api/intake-batches` | `status`, `month`, `iacuc`, `roomName`, `limit`, `offset` | paged `{ items, page }` | filtered by permissions through related room visibility when applicable |
| POST | `/api/intake-batches` | batch payload | `{ item, placementTasks?, auditLogs? }` | saves batch |
| PUT | `/api/intake-batches/{id}` | batch payload | `{ item, placementTasks?, auditLogs? }` | updates batch and reconciles generated tasks |
| DELETE | `/api/intake-batches/{id}` | optional body | `{ ok, item?, auditLogs? }` | deletes batch and related open tasks |
| POST | `/api/intake-batches/{id}/confirm-receipt` | `{ actualReceiptDate, cardCount }` | `{ batch, receipt, placementTasks, auditLogs }` | creates one task per received card |
| GET | `/api/placement-tasks` | `status`, `roomId`, `month`, `limit`, `offset` | paged `{ items, page }` | `status=open` excludes active/cancelled |
| POST | `/api/placement-tasks/{id}/reserve` | `{ slotId }` | `{ task, occupancy, auditLogs }` | creates reserved occupancy |
| POST | `/api/placement-tasks/{id}/move-in` | `{ actualMoveInDate }` | `{ task, occupancy, auditLogs }` | reserved -> active |
| POST | `/api/placement-tasks/{id}/reassign-room` | `{ roomId }` | `{ task, auditLogs }` | admin action |

## Quantity Sheets / Billing

| Method | Path | Request | Response | Notes |
|:-------|:-----|:--------|:---------|:------|
| GET | `/api/quantity-sheets` | `month`, `iacuc`, `pi`, `roomId`, `limit`, `offset` | paged `{ items, page }` | high-frequency billing list |
| GET | `/api/quantity-sheets/{id}` | empty | `{ item }` | permission checked |
| POST | `/api/quantity-sheets` | sheet payload | `{ sheet, affectedSheets, auditLogs }` | creates sheet and transfer mirrors |
| PUT | `/api/quantity-sheets/{id}` | sheet payload | `{ sheet, affectedSheets, auditLogs }` | updates sheet and transfer mirrors |
| DELETE | `/api/quantity-sheets/{id}` | empty | `{ ok, deletedId, affectedSheets, auditLogs }` | removes mirrored transfer rows |
| POST | `/api/quantity-sheets/{id}/generate-statement` | optional body | `{ statement, lines, workflow, auditLogs }` | creates billing workflow |
| POST | `/api/billing-statements/generate` | statement filters | `{ statement, lines, workflow, auditLogs }` | admin |
| POST | `/api/billing-statements/generate-by-pi` | statement filters | `{ statement, lines, workflow, auditLogs }` | admin |
| GET | `/api/billing-workflows` | `month`, `status`, `limit`, `offset` | paged `{ items, page }` | workflow center |
| GET | `/api/billing-workflows/{id}` | empty | `{ workflow, versions, events }` | detail shell |
| GET | `/api/billing-workflows/{id}/lines` | `versionId` | `{ lines }` | detail table |
| POST | `/api/billing-workflows/advance` | `{ workflowId, toStatus, note? }` | `{ workflow, event, auditLogs }` | admin |
| DELETE | `/api/billing-workflows/{id}` | empty | `{ ok, workflow, auditLogs }` | admin |

## System / Data

| Method | Path | Request | Response | Permission |
|:-------|:-----|:--------|:---------|:-----------|
| GET | `/api/health` | empty | `{ ok, database, system }` | public |
| GET | `/api/system/info` | empty | system info | public |
| GET | `/api/system/update-check` | empty | update status from latest Gitea Release | admin |
| GET | `/api/iacuc-index` | empty | full index payload | authenticated |
| GET | `/api/iacuc-index/status` | empty | `{ count, updatedAt, source }` | authenticated |
| POST | `/api/iacuc-index/upload` | multipart CSV | parsed index + audit | admin |
| GET | `/api/principal-identities` | empty | `{ items }` | authenticated |
| PUT | `/api/principal-identities/{name}` | identity payload | saved identity | authenticated |
| GET | `/api/audit-events` | filters | paged audit list | authenticated |

## 拆分约束

- HTTP handler 只负责鉴权、参数解析、状态码和 JSON 响应。
- service 层返回纯 Python dict/list，保持可 JSON 序列化。
- repository 层只处理 SQLite SQL、payload dump/load、事务内读写。
- cache invalidation 从 service 返回 affected domains，由 handler 统一执行。
- 每个写入接口必须返回足够前端局部合并的数据。
