# CageLedger API 契约

本契约描述 React 前端与 Python 服务之间的稳定边界。后端入口位于 `server.py` 和 `server_app/web/`，前端类型位于 `src/contracts/`，请求 hooks 位于 `src/react/api/`。

## 通用约定

| 项目      | 契约                                                           |
| --------- | -------------------------------------------------------------- |
| 基础路径  | `/api`                                                         |
| 认证      | HttpOnly Cookie Session，`SameSite=Lax`                        |
| JSON 请求 | `Content-Type: application/json`                               |
| 错误      | `{ "error": "可展示消息" }`                                    |
| 分页      | `{ items, page: { limit, offset, total, hasMore } }`           |
| 单对象    | 优先 `{ item }`，专用流程接口使用命名字段                      |
| 缓存      | API 响应 `Cache-Control: no-store`；服务端内部使用 15 秒短缓存 |
| 压缩      | 大响应和静态资源按客户端能力使用 gzip                          |
| 计时      | 响应可包含 `Server-Timing`，关键写入可包含 `perf`              |
| 权限      | `admin` 全局；`room_admin` 按授权和业务入口校验                |
| 字段命名  | 前端 JSON 使用 camelCase，SQLite 列使用 snake_case             |

`requestJson<T>()` 统一发送 Cookie、禁用浏览器缓存并将错误转换为 `ApiError`。文件上传使用 `FormData`，由专用上传函数处理。

## 会话和公开接口

| 方法   | 路径                                     | 响应                         | 权限     |
| ------ | ---------------------------------------- | ---------------------------- | -------- |
| `GET`  | `/api/health`                            | `{ ok, database, system }`   | 公开     |
| `GET`  | `/api/system/info`                       | 系统版本和构建信息           | 公开     |
| `GET`  | `/api/public/cage-card/{animalRecordId}` | `{ batch, card }`            | 公开只读 |
| `POST` | `/api/auth/login`                        | `{ user }` + Cookie          | 公开     |
| `POST` | `/api/auth/logout`                       | `{ ok: true }` + 清除 Cookie | 公开     |
| `GET`  | `/api/auth/me`                           | `{ user }`；未登录返回 401   | 会话     |

公开笼卡响应只提供查询所需信息。经费、账号、审计和报销字段不进入公开响应。

## Bootstrap 和设施

| 方法           | 路径                              | 关键参数                     | 响应                                 |
| -------------- | --------------------------------- | ---------------------------- | ------------------------------------ |
| `GET`          | `/api/bootstrap`                  | `scope=summary`              | 首页摘要和设施摘要                   |
| `GET`          | `/api/bootstrap`                  | `scope=room&roomId=...`      | 当前房间笼架、笼位、占用和待进驻任务 |
| `GET`          | `/api/bootstrap`                  | `scope=full`                 | 兼容全量状态                         |
| `POST`         | `/api/infrastructure`             | rooms/racks/slots 的增量集合 | 受影响基础设施对象                   |
| `GET`          | `/api/infrastructure/occupancies` | `month`、`iacuc`、`pi`       | 结算定向占用数据                     |
| `POST` / `PUT` | `/api/occupancies[/{id}]`         | `{ item }`                   | `{ item, affectedSlots? }`           |
| `DELETE`       | `/api/rooms/{id}`                 | 空                           | `{ ok: true }`                       |

`scope=room` 受房间授权过滤。结构写入后同时失效服务端 bootstrap 缓存和前端 bootstrap 查询。

## 笼卡与待进驻

| 方法     | 路径                                       | 请求或参数                                               | 响应                                    |
| -------- | ------------------------------------------ | -------------------------------------------------------- | --------------------------------------- |
| `GET`    | `/api/intake-batches`                      | `limit`、`offset`、`sortKey`、`sortDir`、`columnFilters` | 分页批次                                |
| `GET`    | `/api/intake-batches/filter-options`       | `column` + 当前筛选                                      | 筛选候选值                              |
| `POST`   | `/api/intake-batches`                      | `{ item }`                                               | `{ item, placementTasks?, auditLogs? }` |
| `PUT`    | `/api/intake-batches/{id}`                 | `{ item, expectedUpdatedAt }`                            | `{ item, placementTasks?, auditLogs? }` |
| `DELETE` | `/api/intake-batches/{id}`                 | 空                                                       | 删除结果与受影响任务                    |
| `POST`   | `/api/intake-batches/{id}/confirm-receipt` | `{ actualReceiptDate, cardCount }`                       | 批次、接收记录、任务和审计              |
| `GET`    | `/api/placement-tasks`                     | 分页和状态筛选                                           | 分页任务                                |
| `POST`   | `/api/placement-tasks/{id}/reserve`        | `{ slotId }`                                             | `{ task, occupancy, affectedSlots? }`   |
| `POST`   | `/api/placement-tasks/{id}/move-in`        | `{ actualMoveInDate }`                                   | `{ task, occupancy, affectedSlots? }`   |
| `POST`   | `/api/placement-tasks/{id}/reassign-room`  | `{ roomId }`                                             | 更新任务和审计                          |

Animal Record ID 在批次生成、打印、接收、待进驻、占用和公开扫码之间保持唯一、持久和可追溯。

## 数量统计表与结算

| 方法     | 路径                                           | 请求或参数                               | 响应                                                                   |
| -------- | ---------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| `GET`    | `/api/quantity-sheet-rooms`                    | 空                                       | `{ items }`，跨房间录入候选                                            |
| `GET`    | `/api/quantity-sheets`                         | 分页、排序、`columnFilters`              | 分页统计表                                                             |
| `GET`    | `/api/quantity-sheets/filter-options`          | `column` + 当前筛选                      | 筛选候选值                                                             |
| `GET`    | `/api/quantity-sheets/{id}`                    | 空                                       | `{ item }`                                                             |
| `GET`    | `/api/quantity-sheets/{id}/pdf`                | 空                                       | 单份数量统计表 PDF 下载                                                |
| `POST`   | `/api/quantity-sheets/pdf-export`              | `{ ids }`                                | 单份 PDF 或多份 PDF ZIP 下载                                           |
| `POST`   | `/api/quantity-sheets`                         | `{ sheet }`                              | `{ item, affectedItems? }`；服务端写入登记人员和房间管理员快照         |
| `PUT`    | `/api/quantity-sheets/{id}`                    | `{ sheet, expectedUpdatedAt }`           | `{ item, affectedItems? }`；服务端更新登记人员和房间管理员快照         |
| `DELETE` | `/api/quantity-sheets/{id}`                    | 空                                       | 删除结果、镜像变更和审计                                               |
| `GET`    | `/api/billing-settlement-candidates`           | 分页、排序、`columnFilters`              | 按月份和负责人聚合的结算候选列表                                       |
| `POST`   | `/api/quantity-sheets/{id}/generate-statement` | 结算选项                                 | statement、lines、workflow                                             |
| `POST`   | `/api/billing-statements/generate`             | month/IACUC 等筛选                       | 动态笼位图结算                                                         |
| `POST`   | `/api/billing-statements/generate-by-pi`       | `{ pi, month, sourceType, persist }`     | `{ statement, lines, workflow? }`                                      |
| `GET`    | `/api/billing-settlements/pdf`                 | `month`、`pi`、`sourceType`              | 单份项目负责人结算汇总表 PDF 下载                                      |
| `POST`   | `/api/billing-settlements/pdf-export`          | `{ items: [{ month, pi, sourceType }] }` | 单份 PDF 或多份 PDF ZIP 下载                                           |
| `POST`   | `/api/pdf-exports`                             | `kind` + 数量统计表或结算项数组          | PDF 后台任务；缓存命中时返回 `ready`，其余返回 `queued` 或 `rendering` |
| `GET`    | `/api/pdf-export-jobs/{id}`                    | 空                                       | `{ status, completed, total, downloadUrl?, error? }`                   |
| `GET`    | `/api/pdf-export-jobs/{id}/download`           | 空                                       | 已完成后台任务的 PDF 或 ZIP 下载                                       |
| `GET`    | `/api/billing-statements[/{id}]`               | 空                                       | 当前结算单列表或单条                                                   |

数量统计表保存会同步转入转出镜像，并使受影响的单表 PDF 与按 PI 汇总 PDF 失效后后台预热。按 PI 结算自动纳入同月同负责人的全部有效 IACUC 和统计表。
`fullExemption=true` 表示当前 IACUC 在项目有效期内按每日实际饲养量全额减免；该减免独立于 PI 普通减免额度，并保留在结算明细、PDF 和报销台账中。

## 流程与报销台账

| 方法     | 路径                                        | 请求或参数                                  | 响应                                      |
| -------- | ------------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| `GET`    | `/api/billing-workflows`                    | 分页、月份和状态                            | 分页流程                                  |
| `GET`    | `/api/billing-workflows/{id}`               | 空                                          | `{ workflow, versions, events }`          |
| `GET`    | `/api/billing-workflows/{id}/lines`         | `versionId`                                 | 指定版本明细                              |
| `POST`   | `/api/billing-workflows/advance`            | `{ workflowId, toStatus, note? }`           | workflow、event、auditLogs                |
| `DELETE` | `/api/billing-workflows/{id}`               | 空                                          | 删除结果和审计                            |
| `GET`    | `/api/reimbursement-records`                | `status`、`month`、`pi`、`onlyUnpaid`、分页 | 分页台账                                  |
| `GET`    | `/api/reimbursement-records/{id}`           | 空                                          | item、workflow、versions、events、history |
| `PUT`    | `/api/reimbursement-records/{id}`           | 台账可编辑字段                              | 更新后的完整详情                          |
| `DELETE` | `/api/reimbursement-records/{id}`           | 空                                          | `{ ok: true }`                            |
| `POST`   | `/api/reimbursement-records/import-monthly` | Excel 文件                                  | 导入摘要                                  |
| `POST`   | `/api/reimbursement-records/import-arrears` | Excel 文件                                  | 导入摘要                                  |

报销台账业务键是 `month + pi`。结算版本负责金额来源，台账负责报销状态、已缴和累计未缴。

## 数据与系统管理

| 方法             | 路径                               | 说明                           |
| ---------------- | ---------------------------------- | ------------------------------ |
| `GET` / `POST`   | `/api/users`                       | 管理账号                       |
| `PUT` / `DELETE` | `/api/users/{id}`                  | 更新或删除账号                 |
| `GET`            | `/api/iacuc-index`                 | 完整 IACUC 索引                |
| `GET`            | `/api/iacuc-index/status`          | 索引数量、时间和来源           |
| `POST`           | `/api/iacuc-index/upload`          | 上传 CSV，更新快照和派生字段   |
| `GET`            | `/api/principal-identities`        | PI 身份和减免配置              |
| `PUT`            | `/api/principal-identities/{name}` | 更新 PI 配置                   |
| `GET`            | `/api/audit-events`                | 分页操作日志                   |
| `GET`            | `/api/system/update-check`         | Gitea 最新 Release，管理员权限 |

## Typed API 规则

- 共享类型写入 `src/contracts/<domain>.ts`，`src/react/api/contracts.ts` 仅保留兼容 re-export。
- endpoint hooks 按业务域拆在 `bootstrap.ts`、`intake.ts`、`cages.ts`、`quantitySheets.ts`、`workflows.ts`、`administration.ts`。
- API 契约变更同步更新类型、Query key、缓存失效、服务端测试和浏览器回归。
- 权限、迁移和写入接口按 `testing-strategy.md` 的 API 与双角色路径验证。
- 查询键写入 `queryKeys.ts`。
- 页面组件使用 hooks，文件上传使用 `uploadFile()`。
- 新响应优先消除 `Record<string, unknown>`，为稳定字段定义接口。
- mutation 成功回调更新详情缓存并失效对应根键。

## 兼容与变更规则

- 新字段保持可选，旧库启动迁移完成回填后再提升为必填。
- 删除或重命名字段需要数据库迁移、payload 兼容和前端契约同步方案。
- 列表新增筛选字段需要结构化列、索引、稳定排序和 Query key 参数。
- 权限变化同时更新后端校验、前端可见性、API 文档和浏览器测试。
- 接口变化同步更新本文件与 `wiki/API与数据模型.md`。

## 验证

```bash
npm run check
npm run smoke:api
npm run test:e2e
```

涉及性能的列表和写入再运行 `npm run benchmark`，并检查 `Server-Timing`、`[perf]` 日志和 SQLite 查询计划。
