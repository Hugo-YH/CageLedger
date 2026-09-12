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
| `GET`  | `/api/public/cage-card/{animalRecordId}` | `{ item: CageCardDetails }`  | 公开只读 |
| `POST` | `/api/auth/login`                        | `{ user }` + Cookie          | 公开     |
| `POST` | `/api/auth/logout`                       | `{ ok: true }` + 清除 Cookie | 公开     |
| `GET`  | `/api/auth/me`                           | `{ user }`；未登录返回 401   | 会话     |

公开笼卡响应只提供查询所需信息。经费、账号、审计和报销字段不进入公开响应。

`item` 是笼卡、到货批次、待进驻任务与占用信息的只读投影，前端通过 `usePublicCageCard` 解包后呈现。状态以返回的 `statusLabel` 为准；缺少状态不能自行推断为“待接收”。同一码再次查询或扫描时重新读取，确保接收、预留与入驻后的状态及时更新。扫码回归至少包含真实 API 创建、打印、接收、预留与入驻链路，不能只用模拟响应验证。

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
| `POST`   | `/api/intake-batches/mark-printed`         | `{ ids }`                                                | 批量标记为已打印                        |
| `POST`   | `/api/intake-batches/confirm-receipt`      | `{ ids, actualReceiptDate }`                             | 批量确认剩余笼卡接收并生成待进驻任务    |
| `POST`   | `/api/quantity-sheets/print-data`          | `{ ids }`                                                | 批量读取打印所需的完整统计表            |
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
| `POST`   | `/api/billing-monthly-summary/export`          | `{ month }`                              | 管理员下载按 IACUC 与设施汇总的月度饲养费 Excel                        |
| `POST`   | `/api/pdf-exports`                             | `kind` + 数量统计表或结算项数组          | PDF 后台任务；缓存命中时返回 `ready`，其余返回 `queued` 或 `rendering` |
| `GET`    | `/api/pdf-export-jobs/{id}`                    | 空                                       | `{ status, completed, total, downloadUrl?, error? }`                   |
| `GET`    | `/api/pdf-export-jobs/{id}/download`           | 空                                       | 已完成后台任务的 PDF 或 ZIP 下载                                       |
| `GET`    | `/api/billing-statements[/{id}]`               | 空                                       | 当前结算单列表或单条                                                   |

数量统计表保存会同步转入转出镜像，并使受影响的单表 PDF 与按 PI 汇总 PDF 失效后后台预热。按 PI 结算自动纳入同月同负责人的全部有效 IACUC 和统计表。
PDF 用户导出优先于后台预热任务，未命中缓存的同一文档只生成一次；磁盘缓存按容量与保留时长自动淘汰。管理员可从 `/api/system/environment` 的 `performance.pdf` 查看队列、渲染延迟、失败、超时、缓存命中率和容量。
`fullExemption=true` 表示当前 IACUC 在项目有效期内按每日实际饲养量全额减免；该减免独立于 PI 普通减免额度，并保留在结算明细、PDF 和报销台账中。
月度饲养费汇总仅覆盖数量统计表来源，实时复用按 PI 合表的计费、减免和梯度规则。工作簿按 `IACUC + 设施` 分行，IACUC 索引提供经费和实验日期，结算单列显示单据跟踪登记的结算单交回状态，报销单的经费本编号、报销单编号、报销金额和报销备注仅取单据跟踪交回登记或补录且未撤回的报销单，报销金额为登记报销单金额汇总，无登记时为空，单号列填入全部报销单号；每次导出写入审计日志。

## 流程与报销台账

| 方法     | 路径                                              | 请求或参数                                                     | 响应                                                                                                                |
| -------- | ------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/billing-workflows`                          | 分页、排序、`columnFilters`（月份/状态/负责人/登记人员/IACUC） | 分页流程；未指定状态时默认排除已生成（单据跟踪只展示已发起之后）                                                    |
| `GET`    | `/api/billing-workflows/{id}`                     | 空                                                             | `{ workflow, versions, events }`                                                                                    |
| `GET`    | `/api/billing-workflows/{id}/funding-options`     | 空                                                             | 关联 IACUC 最新经费本候选项、该 PI 全部已登记经费本号及其来源描述；优先独立 `fundCode`，否则从项目来源/支撑经费提取 |
| `GET`    | `/api/billing-workflows/{id}/lines`               | `versionId`                                                    | 指定版本明细                                                                                                        |
| `POST`   | `/api/billing-workflows/advance`                  | `{ workflowId, toStatus, note?, registration? }`               | workflow、event、auditLogs；`registration` 含结算单/报销单交回开关、报销单号与金额，实收金额由后端按报销单自动汇总  |
| `POST`   | `/api/billing-workflows/{id}/reimbursement-forms` | `{ reimbursementForms: [{ formNo, amount }] }`                 | 已归档流程补录报销单，追加到现有报销单并重算实收金额                                                                |
| `DELETE` | `/api/billing-workflows/{id}`                     | 空                                                             | 删除结果和审计                                                                                                      |
| `GET`    | `/api/reimbursement-records`                      | `status`、`month`、`pi`、`onlyUnpaid`、分页                    | 分页台账                                                                                                            |
| `GET`    | `/api/reimbursement-records/{id}`                 | 空                                                             | item、workflow、versions、events、history                                                                           |
| `PUT`    | `/api/reimbursement-records/{id}`                 | 台账可编辑字段                                                 | 更新后的完整详情                                                                                                    |
| `DELETE` | `/api/reimbursement-records/{id}`                 | 空                                                             | `{ ok: true }`                                                                                                      |
| `POST`   | `/api/reimbursement-records/import-monthly`       | Excel 文件                                                     | 导入摘要                                                                                                            |
| `POST`   | `/api/reimbursement-records/import-arrears`       | Excel 文件                                                     | 导入摘要                                                                                                            |

### 多对多核销台账

| 方法   | 路径                                                    | 请求或参数                        | 响应              |
| ------ | ------------------------------------------------------- | --------------------------------- | ----------------- |
| `GET`  | `/api/reimbursement-ledger/obligations`                 | 月份、费用产生负责人、IACUC、分页 | `{ items, page }` |
| `GET`  | `/api/reimbursement-ledger/obligations/{id}`            | 空                                | `{ item }`        |
| `GET`  | `/api/reimbursement-ledger/claims`                      | 单号、经费负责人、状态、分页      | `{ items, page }` |
| `GET`  | `/api/reimbursement-ledger/claims/{id}`                 | 空                                | `{ item }`        |
| `POST` | `/api/reimbursement-ledger/claims`                      | 报销单头与经费明细                | `{ item }`        |
| `PUT`  | `/api/reimbursement-ledger/claims/{id}`                 | 报销单头与经费明细                | `{ item }`        |
| `POST` | `/api/reimbursement-ledger/claims/{id}/attachments`     | PDF、JPEG 或 PNG 文件             | `{ item }`        |
| `GET`  | `/api/reimbursement-ledger/attachments/{id}`            | 空                                | 受鉴权附件流      |
| `POST` | `/api/reimbursement-ledger/claims/{id}/allocations`     | 经费明细、结算应收、本次金额      | `{ item }`        |
| `POST` | `/api/reimbursement-ledger/allocations/{id}/confirm`    | 空                                | `{ item }`        |
| `POST` | `/api/reimbursement-ledger/allocations/{id}/reverse`    | `{ reason }`                      | `{ item }`        |
| `GET`  | `/api/reimbursement-ledger/legacy-records`              | 分页                              | `{ items, page }` |
| `POST` | `/api/reimbursement-ledger/legacy-records/{id}/migrate` | 空                                | `{ item }`        |

> 当前“单据跟踪”以 `/api/billing-workflows` 为主（发起 → 登记归档 → 补录），上述多对多核销台账接口与旧报销单/核销分摊保留为兼容入口，界面已不再使用。

结算应收固化费用产生项目负责人、IACUC、结算版本和待核销金额。报销单以单号为业务键，经费明细保存经费本号、经费负责人和报销金额；同单明细使用同一位经费负责人。已确认核销同时受经费明细余额和结算应收余额约束。历史 `/api/reimbursement-records` 保持兼容和只读迁入入口。

## 数据与系统管理

| 方法             | 路径                                               | 说明                                                     |
| ---------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `GET` / `POST`   | `/api/users`                                       | 管理账号                                                 |
| `PUT` / `DELETE` | `/api/users/{id}`                                  | 更新或删除账号                                           |
| `POST`           | `/api/intake/standardize-strain`                   | 服务端 MGI 品系标准化，登录权限                          |
| `GET`            | `/api/iacuc-index`                                 | 完整 IACUC 索引                                          |
| `GET`            | `/api/iacuc-index/expiry`                          | 精简 IACUC 到期日索引（编码 + 到期日），列表页批量标记用 |
| `GET`            | `/api/iacuc-index/status`                          | 索引数量、时间和来源                                     |
| `POST`           | `/api/iacuc-index/upload`                          | 上传 CSV，更新快照和派生字段                             |
| `GET`            | `/api/principal-identities`                        | PI 身份和减免配置                                        |
| `PUT`            | `/api/principal-identities/{name}`                 | 更新 PI 配置                                             |
| `GET`            | `/api/audit-events`                                | 分页操作日志                                             |
| `GET`            | `/api/system/update-check`                         | Gitea 最新 Release，管理员权限                           |
| `GET`            | `/api/system/environment`                          | 兼容运行环境参数与当前进程性能快照，管理员权限           |
| `GET`            | `/api/system/performance-history`                  | `hours` 内的性能汇总（管理员权限）                       |
| `GET`            | `/api/release-announcements/{version}`             | 当前账号是否已确认指定版本的更新说明                     |
| `POST`           | `/api/release-announcements/{version}/acknowledge` | 确认当前账号已阅读指定版本的更新说明                     |

`/api/system/environment.performance` 返回当前服务进程自启动以来的低开销诊断数据：运行时长、HTTP 请求总数/慢请求/最近 512 个样本的 P50/P95/最大耗时、缓存容量/命中/未命中/过期/淘汰/命中率，以及 SQLite 操作/慢操作/锁错误和延迟摘要。指标随进程重启清零，不是 SLA；页面不得向非管理员请求或展示这些字段，也不得用高频自动轮询放大请求统计。

服务启动后和此后每 5 分钟，服务将聚合快照写入 `system_performance_snapshots`。快照只含计数增量、延迟摘要、缓存命中率、PDF 活动任务和数据库容量，不含用户、请求参数或 SQL 文本；默认保留 1,095 天。采样使用独立短事务，遇到锁冲突或其他失败会跳过当期而不影响业务请求。`/api/system/performance-history` 返回裁剪后的趋势字段，供管理员比较版本升级、重启和优化前后的变化。

## 动物巡检与目录

| 方法   | 路径                                                        | 请求或参数                                               | 响应                                                                                                  | 权限     |
| ------ | ----------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------- |
| `GET`  | `/api/animal-inspection-catalog`                            | 空                                                       | `{ version, modules, nodes, reviewNotice }`                                                           | 登录可见 |
| `GET`  | `/api/animal-inspection-catalog/draft`                      | 空                                                       | `{ version, modules, nodes, hasDraft, active }`；无草稿时克隆 active；`active` 为未转换的生效目录基线 | `admin`  |
| `PUT`  | `/api/animal-inspection-catalog/draft`                      | `{ modules, nodes, expectedUpdatedAt }`                  | 保存后的 `{ version, modules, nodes, hasDraft }`；非法 400、过期 409                                  | `admin`  |
| `POST` | `/api/animal-inspection-catalog/draft/publish`              | 空                                                       | 新 active 的 `{ version, modules, nodes }`；旧 active 转 history                                      | `admin`  |
| `POST` | `/api/animal-inspection-catalog/images`                     | `multipart/form-data`，字段 `file`（jpg/png/webp，≤5MB） | `{ ok, filename, url }`                                                                               | `admin`  |
| `GET`  | `/api/animal-inspection-reference/{filename}`               | 空                                                       | 图片二进制；data 目录优先，resources 回退                                                             | 登录可见 |
| `GET`  | `/api/animal-inspection-catalog/versions`                   | 空                                                       | `{ items: [{ version, source, status, importedAt, nodeCount, isActive }] }`                           | `admin`  |
| `POST` | `/api/animal-inspection-catalog/versions/{version}/restore` | 空                                                       | 新 active 的目录 payload；回滚源内容发布为新版本，旧 active 转 history                                | `admin`  |

目录草稿契约与 `GET /api/animal-inspection-catalog` 的 `modules`/`nodes` 结构一致；草稿节点可引用现有分类/子分类的 `id` 或 `code` 作为 `parentId`。发布后版本号为 `manual-YYYYMMDD-HHMM`，历史版本保留在 `inspection_catalog_versions`，答案快照语义不受影响。

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

涉及性能的列表和写入再运行 `npm run benchmark`，并检查 `Server-Timing`、`[perf]` 日志和 SQLite 查询计划。涉及缓存、索引、SQLite 查询、PDF 渲染、批量操作或首屏加载时，还要用相同时间窗口的 `/api/system/performance-history` 对比改动前后，记录版本、HTTP/SQLite P95、慢请求、锁错误和结论；该记录只供管理员趋势与验收使用。

## 检疫管理

`/api/quarantine/` 下所有接口要求登录；第一版全部登录角色可读写，权限集中在检疫领域。批次来源取到货记录快照，检测保存混样及项目判定，不建立单笼采样关联。

| 方法       | 相对路径                                      | 行为                                                    |
| ---------- | --------------------------------------------- | ------------------------------------------------------- |
| GET        | `catalog`、`supplier-options`、`batch-number` | 项目配置、供应商候选与 `BYYMMDDNN` 建议批次编号         |
| GET        | `sources`、`batches`                          | 分页来源与检疫批次，支持日期或批次编号筛选              |
| POST / PUT | `batches[/{id}]`、`tests[/{id}]`              | 创建或编辑，正文 `{ item, expectedUpdatedAt }`          |
| DELETE     | `batches/{id}`                                | 删除无检测记录的批次，正文 `{ expectedUpdatedAt }`      |
| GET        | `batches/{id}`                                | 覆盖范围、检测、附件与历史报告版本                      |
| POST       | `tests/{id}/attachments`                      | multipart字段file；查询参数传关联样本、项目、分类及版本 |
| GET        | `attachments/{id}`、`reports/{id}`            | 受鉴权下载                                              |
| GET        | `tests/{id}/preview`                          | 带草稿标识的Word预览                                    |
| POST       | `tests/{id}/issue`                            | 传检测和批次版本；成功生成文件后保存不可变快照          |
| POST       | `tests/{id}/correction`、`tests/{id}/retest`  | 新草稿ID及版本；复检另传供应商                          |
| GET        | `suppliers`                                   | 供应商、日期范围／类型、种类、方法、结果过滤，含明细    |

编辑必须提供 `expectedUpdatedAt`，缺失或过期返回409；出具另传 `expectedBatchUpdatedAt`。出具重试返回已有报告，生成失败保留草稿。更正新建检测记录并关联原版本，旧Word继续可下载。事务记录操作者与审计快照。`quarantine_batches/tests/attachments/reports` 与 `files/quarantine/` 共同组成检疫备份范围。

检疫批次编号首次保存后冻结，流水号一经分配不再回收。正式报告按 `{批次编号}{M|E|P}{YYMMDD}{NN}` 编号；ELISA 大小鼠共用 `E` 序列，更正版本沿用报告编号并递增独立版本号。报告编号保存在系统记录中，正式 Word 暂不打印该编号。

检疫来源 `sources` 仅返回 `received` 到货记录，默认排除已归入检疫批次的动物；`state=all` 返回所有已接收记录及 `quarantineStatus`、`quarantineBatches`。接收列表也返回这两个只读衍生字段，不改变原接收状态或写入原到货 payload。

`POST batches/{id}/complete` 接收 `{ expectedUpdatedAt, expectedTestVersions: { [testId]: updatedAt } }`，校验三类正式报告、适用动物种类、异常复检和批次结论，在单事务保存完成时间、确认人、报告关联及审计。重复确认返回已完成记录；并发变化返回409。更正或复检会重新打开该批次，历史完成快照保留。

### 检疫报告表单 v2

检测写入 `reportFormVersion: 2` 后，服务端对每组 `sourceIds` 去重，固定 `poolCount = 1`、`portionCount = sourceIds.length`；`reportMaterial` 与 `reportSpecimenState` 保存报告首节信息。新记录出具不要求额外 `conclusion`，批次完成结论校验不变。

附件上传接受 JSON 字符串 `projectIds`；`PUT /api/quarantine/attachments/{id}` 使用检测记录的 `expectedUpdatedAt` 校验，可修改多个项目关联、图注、顺序和草稿移除标记。返回附件与检测记录的新版本。保留首次 `uploadedBy`、`uploadedAt`，后续修改单独审计。正式版本附件不可修改，更正草稿复制关联，旧文件和报告快照保留。
