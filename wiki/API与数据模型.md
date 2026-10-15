# API 与数据模型

共用结算请求由 `src/react/api/settlements.ts` 提供候选、预览、发起与导出入口，原数量统计表和技术服务接口继续兼容。两类费用的原URL、业务键、版本核对和账单快照规则不变。后端按领域集中登记到 `server_app/web/router_registry.py`；登记方法与路径须和 [[API接口清单]] 双向对应。

完整接口目录、权限及写入保护摘要见 [[API接口清单]]。该页由仓库 `docs/contracts/api-inventory.json` 生成，支持按领域核对方法、路径、调用模块、兼容入口及读写副作用；维护命令为 `npm run api:inventory` 和 `npm run check:api`。

本页提供 API 和数据模型概览。完整工程契约见 `docs/contracts/api-contracts.md`，前端类型源位于 `src/react/api/contracts.ts`。

## 架构链路

```mermaid
graph LR
    React["React feature"] --> Query["TanStack Query hook"]
    Query --> API["Python /api"]
    API --> Service["service"]
    Service --> Repo["repository"]
    Repo --> DB["SQLite"]
```

开发模式由 Vite 将 `/api` 代理到 `5174`。生产模式由 Python 在 `5173` 同时提供门户、运营系统、文档、`web-dist/` 和 API。

## 通用响应

| 类型     | 形状                                                                 |
| -------- | -------------------------------------------------------------------- |
| 错误     | `{ "error": "message" }`                                             |
| 分页     | `{ "items": [], "page": { "limit", "offset", "total", "hasMore" } }` |
| 单对象   | `{ "item": {} }`                                                     |
| 会话     | `{ "user": {} }`                                                     |
| 流程详情 | 命名字段组合，例如 `workflow`、`versions`、`events`                  |

认证使用 HttpOnly Cookie Session。`admin` 具备全局管理权限，`room_admin` 按房间授权和具体业务入口校验。

## API 家族

### 会话和公开查询

| 方法   | 路径                                               | 用途                                   |
| ------ | -------------------------------------------------- | -------------------------------------- |
| `GET`  | `/api/health`                                      | 服务、数据库、版本和 revision          |
| `GET`  | `/api/system/info`                                 | 系统元数据                             |
| `POST` | `/api/auth/login`                                  | 登录                                   |
| `POST` | `/api/auth/logout`                                 | 退出                                   |
| `GET`  | `/api/auth/me`                                     | 当前会话                               |
| `GET`  | `/api/release-announcements`                       | 当前账号全部已确认版本                 |
| `POST` | `/api/release-announcements/acknowledge`           | 批量确认本次展示的版本，失败不部分写入 |
| `GET`  | `/api/release-announcements/{version}`             | 当前账号的版本更新说明确认状态         |
| `POST` | `/api/release-announcements/{version}/acknowledge` | 确认当前账号已阅读该版本说明           |
| `GET`  | `/api/public/cage-card/{animalRecordId}`           | 免登录笼卡查询                         |

### 设施和笼位

| 方法           | 路径                                   | 用途                           |
| -------------- | -------------------------------------- | ------------------------------ |
| `GET`          | `/api/bootstrap?scope=summary`         | 首页摘要                       |
| `GET`          | `/api/bootstrap?scope=room&roomId=...` | 单房间笼架、笼位、占用和待进驻 |
| `GET`          | `/api/bootstrap?scope=full`            | 兼容全量状态                   |
| `POST`         | `/api/infrastructure`                  | 房间、笼架和笼位增量维护       |
| `POST` / `PUT` | `/api/occupancies[/{id}]`              | 占用写入                       |
| `GET`          | `/api/infrastructure/occupancies`      | 月度结算定向占用               |

### 笼卡和待进驻

| 方法             | 路径                                       | 用途                     |
| ---------------- | ------------------------------------------ | ------------------------ |
| `GET` / `POST`   | `/api/intake-batches`                      | 分页查询或新建批次       |
| `PUT` / `DELETE` | `/api/intake-batches/{id}`                 | 编辑或删除批次           |
| `POST`           | `/api/intake-batches/{id}/confirm-receipt` | 确认接收并生成待进驻任务 |
| `POST`           | `/api/intake-batches/mark-printed`         | 批量标记为已打印         |
| `POST`           | `/api/intake-batches/confirm-receipt`      | 批量确认接收并生成任务   |
| `POST`           | `/api/quantity-sheets/print-data`          | 批量读取统计表打印数据   |
| `GET`            | `/api/placement-tasks`                     | 分页查询待进驻任务       |
| `POST`           | `/api/placement-tasks/{id}/reserve`        | 预留笼位                 |
| `POST`           | `/api/placement-tasks/{id}/move-in`        | 正式入驻                 |
| `POST`           | `/api/placement-tasks/{id}/reassign-room`  | 变更目标房间             |

### 动物巡检

| 方法           | 路径                                           | 用途                         |
| -------------- | ---------------------------------------------- | ---------------------------- |
| `GET`          | `/api/animal-inspection-catalog`               | 当前启用的巡检标准与参考图例 |
| `GET` / `POST` | `/api/animal-inspections`                      | 巡检列表和草稿创建           |
| `GET` / `PUT`  | `/api/animal-inspections/{id}`                 | 巡检详情与草稿保存           |
| `POST`         | `/api/animal-inspections/{id}/submit`          | 提交并锁定巡检               |
| `POST`         | `/api/animal-inspections/{id}/attachments`     | 上传巡检照片                 |
| `POST`         | `/api/animal-inspections/{id}/export-pdf`      | 生成巡检报告 PDF             |
| `GET`          | `/api/animal-inspection-findings`              | 异常处置列表                 |
| `POST`         | `/api/animal-inspection-findings/{id}/actions` | 登记处置措施                 |
| `POST`         | `/api/animal-inspection-findings/{id}/recheck` | 新建复查记录                 |
| `POST`         | `/api/animal-inspection-findings/{id}/resolve` | 关闭异常项                   |

### 数量统计表和结算

系统对已核算金额使用兼容的整数分字段：原有元字段与JSON保留，接口和导出仍按元及既有金额格式展示。整分金额的核销累计、余额和限额校验采用整数计算，避免 `0.10 + 0.20` 等二进制浮点误差；历史非整分值保留原值并走兼容路径，不强制取整。单价、比例和数量精度及原有舍入规则保持不变，历史账单快照不重算。

数量统计表以 `id` 标识，月份、IACUC和房间的组合允许多张记录，不设置组合唯一约束。账单明细、账单版本及流程事件分别使用“版本＋日期”“流程＋版本号”“流程＋事件时间”复合索引；日期或版本号相同时沿用原有行顺序。旧库初始化先建立替代索引，再移除被覆盖的非唯一索引，保留已有唯一约束和历史账单内容。

账单快照支持旧JSON和按版本无损压缩的明细块，接口继续返回完整项目、日期、单位、数量、单价和金额。`billing_statement_line_blocks`保存codec、原始长度、SHA-256、行数和压缩数据，逐日表保留列表摘要；小快照沿用JSON，历史数据不在启动时自动重写。压缩块校验失败或缺失时明确报错，不用实时项目数据替代历史账单。

离线副本可通过 `scripts/compact_billing_snapshots.py` 转换，输入和输出必须为不同文件，输出文件不能已存在：

```bash
node scripts/run_python.mjs scripts/compact_billing_snapshots.py --database /path/to/offline-copy.sqlite --output /path/to/compact-copy.sqlite --mode compact --vacuum
node scripts/run_python.mjs scripts/compact_billing_snapshots.py --database /path/to/compact-copy.sqlite --output /path/to/legacy-copy.sqlite --mode expand --vacuum
```

工具逐版本核对快照内容及顺序，只修改输出副本。回退到不支持压缩快照的旧版系统时，先生成并校验 `expand` 旧格式副本。

自定义收费区间 `customBillingSegments` 支持 `quantityMode: "fixed" | "all"`。固定模式填写每日数量；全部模式保存 `quantity: null`，按区间内每天实际结余计费。旧区间未提供模式时由数量兼容推断。全部模式与其他自定义区间不能重叠；账单快照保存模式及每天实际计费数量，不改变既有历史版本。

| 方法                     | 路径                                     | 用途                           |
| ------------------------ | ---------------------------------------- | ------------------------------ |
| `GET`                    | `/api/quantity-sheet-rooms`              | 统计表跨房间录入候选           |
| `GET` / `POST`           | `/api/quantity-sheets`                   | 分页查询或新建统计表           |
| `GET` / `PUT` / `DELETE` | `/api/quantity-sheets/{id}`              | 详情、编辑和删除               |
| `POST`                   | `/api/quantity-sheets/pdf-export`        | 创建统计表 PDF 导出任务        |
| `GET`                    | `/api/billing-settlement-candidates`     | 按 PI 结算候选、筛选与排序     |
| `POST`                   | `/api/billing-statements/generate-by-pi` | 按 PI 汇总结算                 |
| `POST`                   | `/api/billing-settlements/pdf-export`    | 创建结算单 PDF 或批量 ZIP 任务 |
| `POST`                   | `/api/billing-monthly-summary/export`    | 管理员导出月度饲养费汇总 Excel |
| `GET`                    | `/api/billing-statements/{id}`           | 单张结算单                     |
| `GET`                    | `/api/pdf-export-jobs/{id}`              | 查询 PDF 导出任务状态          |
| `GET`                    | `/api/pdf-export-jobs/{id}/download`     | 下载已完成 PDF 或 ZIP          |

### 流程和报销

| 方法                     | 路径                                                 | 用途                               |
| ------------------------ | ---------------------------------------------------- | ---------------------------------- |
| `GET`                    | `/api/billing-workflows`                             | 结算流程列表                       |
| `GET`                    | `/api/billing-workflows/{id}`                        | 流程、版本和事件                   |
| `GET`                    | `/api/billing-workflows/{id}/funding-options`        | 最新经费本候选项                   |
| `GET`                    | `/api/billing-workflows/{id}/lines`                  | 指定版本逐日明细                   |
| `POST`                   | `/api/billing-workflows/advance`                     | 推进流程                           |
| `POST`                   | `/api/billing-workflows/{id}/reimbursement-forms`    | 已登记或已归档流程按授权补录报销单 |
| `GET`                    | `/api/reimbursement-records`                         | 报销台账列表                       |
| `GET` / `PUT` / `DELETE` | `/api/reimbursement-records/{id}`                    | 台账详情、登记和删除               |
| `POST`                   | `/api/reimbursement-records/import-monthly`          | 导入历史月汇总 Excel               |
| `POST`                   | `/api/reimbursement-records/import-arrears`          | 导入历史欠缴 Excel                 |
| `GET`                    | `/api/reimbursement-ledger/obligations`              | 结算应收列表                       |
| `GET` / `POST`           | `/api/reimbursement-ledger/claims`                   | 报销单列表和新建                   |
| `GET` / `PUT`            | `/api/reimbursement-ledger/claims/{id}`              | 报销单详情和编辑                   |
| `POST`                   | `/api/reimbursement-ledger/claims/{id}/attachments`  | 上传报销单附件                     |
| `GET`                    | `/api/reimbursement-ledger/attachments/{id}`         | 鉴权下载报销单附件                 |
| `POST`                   | `/api/reimbursement-ledger/claims/{id}/allocations`  | 创建核销草稿                       |
| `POST`                   | `/api/reimbursement-ledger/allocations/{id}/confirm` | 确认核销                           |
| `POST`                   | `/api/reimbursement-ledger/allocations/{id}/reverse` | 撤销核销                           |

> 当前“单据跟踪”以 `/api/billing-workflows` 为主（发起 → 登记归档 → 补录）；`/api/reimbursement-ledger` 与旧报销单/核销分摊接口保留为兼容入口，界面已不再使用。

### 管理

| 方法             | 路径                               | 用途                   |
| ---------------- | ---------------------------------- | ---------------------- |
| `GET` / `POST`   | `/api/users`                       | 账号查询和创建         |
| `PUT` / `DELETE` | `/api/users/{id}`                  | 账号维护               |
| `POST`           | `/api/intake/standardize-strain`   | 服务端 MGI 品系标准化  |
| `GET`            | `/api/iacuc-index`                 | 完整项目索引           |
| `GET`            | `/api/iacuc-index/status`          | 索引状态               |
| `POST`           | `/api/iacuc-index/upload`          | CSV 上传和派生数据同步 |
| `GET`            | `/api/principal-identities`        | PI 身份与减免配置列表  |
| `PUT`            | `/api/principal-identities/{name}` | 保存 PI 身份与减免配置 |
| `GET`            | `/api/audit-events`                | 分页审计日志           |
| `GET`            | `/api/system/update-check`         | Gitea Release 更新检查 |

### 离线账务一致性检查

维护工具仅检查和生成报告，不执行迁移、修复、删除、核销或重新计费：

```bash
node scripts/run_python.mjs scripts/check_billing_consistency.py --database /path/to/offline-copy.sqlite --report /path/to/new-report.json
```

输入必须是稳定的离线SQLite副本；存在非空WAL时拒绝检查，应先用SQLite备份生成完整副本。工具通过只读连接将输入备份到临时库，再以只读方式检查临时库，最后核对输入SQLite、WAL及SHM的大小与SHA-256。报告不能覆盖已有文件、数据库或数据库附属文件。临时库在检查结束后自动清理。

需要对比基准代码与当前工作区的完整链路时，可执行：

```bash
npm run verify:database -- --database /absolute/path/offline-backup.sqlite --baseline-ref HEAD --output /absolute/path/new-private-review
```

该命令为两版代码分别建立独立数据库副本，核对原记录、审计全文、账单快照、重新计算、实际HTTP和导出结果。原应收GET同步只在副本发生并单独比对；旧接口和业务口径不改变。默认PDF最多抽样3份，`--pdf-samples all` 核对全部PDF；所有账单的HTML和Excel均比较。输出 `report.md`、`report.json` 及私有证据，拒绝覆盖已有目录，运行后核对输入文件和代码指纹。`passed_with_warnings` 表示兼容对比通过但仍保留既有历史问题，不能据此称所有数据无异常。完整边界见仓库 `docs/contracts/database-copy-review.md`。

报告包含SQLite完整性、已声明外键、结算流程当前版本归属、应收来源、已确认核销累计、报销单及经费明细余额、原报销台账余额、元与分字段一致性，以及旧JSON／压缩账单快照校验。只计入已确认核销，草稿和已撤销核销不计金额；应收的核销计数沿用不同经费明细数。已撤销应收允许保留历史，但应收余额、已核销金额和核销计数应为零，不能存在已确认核销。负数调整应收及关联旧版本的有效应收不视为异常。

无已确认核销的历史孤立应收列为警告，现行有效应收列表已排除这些记录；存在已确认核销时列为错误。尚无整数分字段的旧库仍可检查；合法历史非整分金额只记录兼容路径覆盖情况，不强制取整。原报销台账与核销体系并行，不将原台账已缴金额强行等同核销金额。累计金额只检查存储的应缴、已缴与未缴关系，不重建跨月累计；账单快照只检查完整读取及存储校验，不重新计算收费和减免规则。

退出码：`0` 表示检查完成且无错误，仍可能有警告；`1` 表示发现错误或检查项未完成；`2` 表示输入、输出或执行失败。报告的 `status`、`summary`、`checks` 与 `coverage` 区分错误、警告和旧库字段覆盖，不能只看退出码忽略警告。报告包含记录ID及异常金额，应按业务数据保管；不输出项目负责人、经费本号或原始JSON。

### 升级检查与历史问题留档

管理员可在“系统设置 → 数据核查”查看已有留档、问题分类、关联记录及原始证据。三个只读接口为 `GET /api/data-quality/scans`、`GET /api/data-quality/scans/{scanId}/issues` 和 `GET /api/data-quality/scans/{scanId}/issues/{issueId}`；支持历史留档分页、问题分页与分类筛选，证据按需加载并核对指纹。房间管理员无权访问；查看与刷新不触发扫描、修复或新增审计。列表使用所选留档当时的分类，不能把后续留档中未出现的问题当作已解决。接口参数详见[API接口清单](API接口清单.md)。

升级后首次启动会在结构迁移完成后，按运行库当时的实际记录自动检查并留档，无需手工搬库。检查范围包括活动占用的笼位引用、进驻任务的父批次及分次接收明细、重复的旧格式二维码别名、失去来源流程的历史应收。批量“确认已接收”没有分次明细属于现有业务规则，不单独标记；接收明细须在任务自己的父批次中匹配，不能用其他批次的同名ID替代。

`data_quality_upgrade_runs` 按检查器版本记录完成结果。同一检查器版本成功后，重复启动复用既有留档，不重新扫描、不更新发现时间、不重复写证据或审计；不是持续数据监控。后续调整检查范围或规则时必须更新 `DETECTOR_VERSION`，新版本再按届时实际数据执行一次，旧标记及证据保留。检查、证据、摘要审计和完成标记在同一事务中保存；中断或失败全部回滚，本次启动报错，下一次启动重试，不把失败当成已完成。有业务数据的库即使未发现问题也保存检查摘要审计；空白新库记录一次完成结果，不额外生成业务审计。

自动检查在数据库事务内读取一致的实际记录，包括已提交的WAL内容。`sourceSha256` 是所列检查输入行的逻辑指纹，`sourceSnapshot.format=sqlite-review-inputs-v1` 和 `sourceSnapshot.tables` 说明编码与覆盖；不把正在运行的SQLite主文件哈希当作完整备份指纹。自动检查的 `trigger=upgrade`，操作者为“系统升级核查”。它不修改业务正文、金额、二维码或原审计，不恢复接收明细、不重关联笼位、不删除孤立应收，也不因本次未检出而自动销项。

需要另行核查离线备份时，仍可使用独立工具生成带标记的新副本及JSON清单：

```bash
node scripts/run_python.mjs scripts/archive_data_quality_issues.py --database /path/to/offline-copy.sqlite --output /path/to/marked-copy.sqlite --report /path/to/new-review.json --actor-name "核查操作者"
```

`data_quality_issues` 保存问题标记和业务记录ID，`data_quality_scans` 保存来源指纹、检查器版本、操作者和核查范围，`data_quality_observations` 追加各次证据及校验和。证据包含原业务正文；来源明细只在审计中存在时，保留完整明细快照及审计事件ID。普通问题标记为 `needs_review`；无已确认核销且已被现行规则排除的孤立应收标记为 `retained_history`。这些标记独立于业务状态，不改变有效应收、核销、收费和权限规则。离线留档与 `data_quality.issues_archived` 审计原子保存，同一来源、检查版本和检测结果重试不重复登记，不会将生产升级检查标为完成。

输入应为完整离线备份，非空WAL及已有输出均拒绝处理。工具核对原字段和记录不变，最后核对输入SQLite、WAL、SHM指纹；失败删除本次未完成输出。副本和清单权限为 `0600`，含生产业务原文，须与备份一起保管，不提交到Git。`latestBusinessAt` 仅表示库内已有实际写入时间，计划服务／接收日期不证明之后记录已包含；本工具的退出成功表示留档完成，不等于所有业务数据无异常。数据库外附件仍须结合本地文件备份及远端附件另行核验。

### 审计详情存储与转移关联索引

较大的新审计记录使用 `audit_event_payload_blocks` 无损保存完整原始JSON，`audit_events` 保留原有检索字段和摘要。读取列表仍按原来的规则裁剪前后快照，完整维护读取使用 `server_app.repositories.audit_storage.read_payload`，不直接把摘要当作完整审计。压缩块保存编码、原始字节数和SHA-256，并校验事件ID与摘要；缺失或损坏时明确报错。小记录和压缩收益不足的记录沿用JSON，启动只创建结构，不自动重写历史。

历史审计可在离线副本上压缩或还原：

```bash
node scripts/run_python.mjs scripts/compact_audit_events.py --database /path/to/offline-copy.sqlite --output /path/to/compact-copy.sqlite --mode compact --vacuum
node scripts/run_python.mjs scripts/compact_audit_events.py --database /path/to/compact-copy.sqlite --output /path/to/legacy-copy.sqlite --mode expand --vacuum
```

工具拒绝覆盖文件、输入输出相同和非空WAL，逐事件验证原始JSON字节摘要，只修改输出副本。旧版系统或直接读取原JSON的外部工具应使用校验后的 `expand` 副本。

`quantity_sheet_transfer_links` 是可重建的镜像关联索引，保存来源表、来源行、目标表、目标行、方向及原有贡献数量；正文JSON仍是业务数据来源。首次启动从原镜像字段回填，保存表时同步更新关联，不设置“月份＋IACUC＋房间”唯一约束。旧SQL写入正文时由触发器标记待刷新，转移查询前刷新；删除目标表清理其关联，即使连接未开启外键也不会留下目标索引。来源不设置删除级联外键，历史来源缺失不会导致已有正文被改写。

转移查询按来源表ID精确匹配并覆盖该来源已删除的旧行，随后沿用现有镜像清理和重建算法。不再依靠JSON文本中的ID片段或SQL通配符匹配，备注中的相似ID不产生关联。存储优化不改变数量、收费、已有账单快照、房间权限或经手人判断。

## 核心数据对象

| 对象                                    | 业务键                   | 说明                               |
| --------------------------------------- | ------------------------ | ---------------------------------- |
| `experiment_applications`               | IACUC                    | 项目、PI、实验负责人、来源和有效期 |
| `intake_batches`                        | batch id                 | 接收批次和打印卡集合               |
| `cards`                                 | Animal Record ID         | 单张笼卡的持久唯一身份             |
| `placement_tasks`                       | task id                  | 接收后到正式入驻的任务             |
| `occupancies`                           | occupancy id + slot id   | 笼位占用历史                       |
| `quantity_sheets`                       | month + IACUC + sheet id | 月度人工数量记录                   |
| `billing_statements`                    | statement/version id     | 月度结算结果                       |
| `billing_workflows`                     | workflow id              | 结算单状态和版本链                 |
| `animal_inspections`                    | inspection id            | 饲养间巡检、快照和提交状态         |
| `inspection_findings`                   | finding id               | 异常发现、处置和复查链             |
| `reimbursement_claims`                  | claim number             | 报销单头和经费负责人               |
| `reimbursement_allocations`             | allocation id            | 经费明细与结算应收的核销分摊       |
| `reimbursement_records`                 | month + PI               | 应缴、已缴、未缴和报销状态         |
| `audit_events`                          | event id                 | 关键写操作审计                     |
| `release_announcement_acknowledgements` | user id + version        | 每位用户逐版本的更新说明确认记录   |

SQLite 同时保留结构化热字段和兼容 payload。启动迁移会补字段、索引和必要回填。

## 前端缓存

- API hooks 位于 `src/react/api/`。
- 查询键位于 `queryKeys.ts`。
- 默认 staleTime 15 秒，gcTime 5 分钟。
- mutation 根据写入范围失效当前房间、当前列表或台账根键。
- localStorage 只保存界面偏好。

## 相关页面

- [[项目结构]]
- [[数据管理与IACUC索引]]
- [[饲养费核算]]
- [[开发规范]]
- 文档维护规则位于仓库 `docs/contracts/documentation-system.md`。

## 检疫领域

检疫入口为 `/api/quarantine/`，全部接口校验登录，第一版所有登录角色可读写。提供批次、检测、原始附件、报告预览／出具／更正、分供应商复检和历史查询。接口细节见项目 `docs/contracts/api-contracts.md` 的检疫管理条目。

SQLite中的 `quarantine_batches` 保存覆盖来源快照和最终结论；`quarantine_tests` 保存各方法混样、项目结果与复检／更正关系；`quarantine_attachments` 保留每次上传人和时间；`quarantine_reports` 保存已出具快照和版本。文件位于 `data/files/quarantine/`，下载要求会话鉴权。编辑按服务端版本校验，操作进入审计日志。

`GET /api/quarantine/batches/{id}/summary?kind=quarantine|self` 下载旧版式汇总 PDF。标题选择不筛除批次来源；已出具检测读取冻结快照，更正替代原记录，复检独立列出，含未出具记录时标为汇总草稿。汇总导出不写入上述业务表，不推进批次状态或替换已有报告。
