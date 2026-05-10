# API 和数据模型

CageLedger 的共享模式由 `server.py` 提供 HTTP API。后端使用 SQLite 存储，写入操作会执行权限校验并记录审计事件。

## 健康检查与系统信息

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 返回服务、数据库和系统信息 |
| `GET` | `/api/system/info` | 返回版本、单位、版权和仓库信息 |
| `GET` | `/api/system/update-check` | 检查 GitHub 目标分支最新提交 |

## 登录与账号

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/logout` | 登出 |
| `GET` | `/api/auth/me` | 获取当前账号 |
| `GET` | `/api/users` | 列出账号，仅管理员 |
| `POST` | `/api/users` | 创建账号，仅管理员 |
| `PUT` | `/api/users/{id}` | 更新账号，仅管理员 |
| `DELETE` | `/api/users/{id}` | 删除账号，仅管理员 |

账号角色：

- `admin`：系统管理员，拥有全部功能权限。
- `room_admin`：房间管理员，只能编辑授权饲养间内的笼位占用信息。

## 业务实体 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/rooms` | 饲养间列表 |
| `POST` | `/api/rooms` | 创建饲养间 |
| `PUT` | `/api/rooms/{id}` | 更新饲养间 |
| `DELETE` | `/api/rooms/{id}` | 删除饲养间 |
| `GET` | `/api/racks` | 笼架列表 |
| `POST` | `/api/racks` | 创建笼架 |
| `PUT` | `/api/racks/{id}` | 更新笼架 |
| `DELETE` | `/api/racks/{id}` | 删除笼架 |
| `GET` | `/api/cage-slots` | 笼位列表 |
| `POST` | `/api/cage-slots` | 创建笼位 |
| `PUT` | `/api/cage-slots/{id}` | 更新笼位 |
| `DELETE` | `/api/cage-slots/{id}` | 删除笼位 |
| `GET` | `/api/occupancies` | 占用记录列表 |
| `POST` | `/api/occupancies` | 创建占用记录 |
| `PUT` | `/api/occupancies/{id}` | 更新占用记录 |
| `DELETE` | `/api/occupancies/{id}` | 删除占用记录 |
| `GET` | `/api/billing-rules` | 计费规则列表 |
| `POST` | `/api/billing-rules` | 创建计费规则 |
| `PUT` | `/api/billing-rules/{id}` | 更新计费规则 |
| `DELETE` | `/api/billing-rules/{id}` | 删除计费规则 |
| `GET` | `/api/billing-adjustments` | 减免规则列表 |
| `POST` | `/api/billing-adjustments` | 创建减免规则 |
| `PUT` | `/api/billing-adjustments/{id}` | 更新减免规则 |
| `DELETE` | `/api/billing-adjustments/{id}` | 删除减免规则 |
| `GET` | `/api/intake-batches` | 待接收批次和笼卡打印记录列表 |
| `POST` | `/api/intake-batches` | 创建待接收批次 |
| `PUT` | `/api/intake-batches/{id}` | 更新待接收批次 |
| `DELETE` | `/api/intake-batches/{id}` | 删除待接收批次 |
| `GET` | `/api/experiment-applications` | 实验申请汇总表 |
| `GET` | `/api/billing-statements` | 结算单列表 |
| `GET` | `/api/billing-statement-lines` | 结算单明细 |
| `POST` | `/api/billing-statements/generate` | 按伦理号生成结算单（分表） |
| `POST` | `/api/billing-statements/generate-by-pi` | 按项目负责人生成结算单（合表，用于导出） |
| `GET` | `/api/audit-events` | 审计事件 |

## 数量统计表结算

用于兼容纸质《实验动物数量统计表》工作流。房间管理员可录入月底统计表，系统按变更行展开每日结余数量；生成结算单时会按同月同项目负责人汇总多个 IACUC。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/quantity-sheets` | 数量统计表列表 |
| `POST` | `/api/quantity-sheets` | 创建数量统计表 |
| `PUT` | `/api/quantity-sheets/{id}` | 更新数量统计表 |
| `DELETE` | `/api/quantity-sheets/{id}` | 删除数量统计表 |
| `POST` | `/api/quantity-sheets/{id}/generate-statement` | 按数量统计表生成结算单 |

数量统计表包含表头信息和变更行。核心字段：

- 表头：`month`、`roomId`、`roomName`、`manager`、`iacuc`、`project`、`pi`、`owner`、`funding`、`billingUnit`、`initialAnimalCount`、`initialCageCount`
- 明细行：`date`、`addedCount`、`addedType`、`removedCount`、`removedType`、`animalCount`、`cageCount`、`notes`
  - 可选转移字段：`transferInFromIacuc`、`transferOutToIacuc`（用于 A/B 伦理号间转移自动增减）

当前核算单位固定为：

- `cage_day`：按笼/天计费。

结算规则：

- 结算维度：
  - 分表：按伦理号（IACUC）和月份生成单独结算单（`/api/billing-statements/generate`）。
  - 合表：按项目负责人和月份汇总多个 IACUC 生成导出结算单（`/api/billing-statements/generate-by-pi`）。
- 免费额度：按项目负责人每日合计笼数抵扣。负责人类型为 PI 时免费 20 笼/天，独立科研人员免费 10 笼/天；负责人身份保存在 `principal_identities` 表中，未编辑的负责人默认按独立科研人员计算。
- 阶梯计价：每日合计笼数先切分价格区间，前 160 笼为 4.5 元/笼/天，超过 160 笼部分为 6.5 元/笼/天；免费额度优先抵扣首单元。

`/api/state` 仍保留为兼容、导入导出或调试接口。前端正常读写已迁移到实体级 API。

## 笼卡管理

用于预约接收消息到检疫笼卡打印的工作流。前端会保存粘贴的原始预约消息、识别后的批次字段、最终打印张数和批次状态；打印时按每个待接收批次展开笼卡实例。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/intake-batches` | 读取待接收批次列表 |
| `POST` | `/api/intake-batches` | 保存新的待接收批次 |
| `PUT` | `/api/intake-batches/{id}` | 更新待接收批次、打印张数或状态 |
| `DELETE` | `/api/intake-batches/{id}` | 删除待接收批次 |

核心字段：

- 批次信息：`batchNo`、`iacuc`、`supplier`、`rawMessage`、`purchaseOrderNo`
- 动物信息：`species`、`strainRaw`、`strainStandard`、`quantity`
- 接收信息：`roomName`、`intakeDate`、`husbandryDays`、`endDate`、`receiverName`、`vetPhone`
- 项目快照：`project`、`pi`、`owner`
- 打印控制：`suggestedAnimalsPerCage`、`suggestedCardCount`、`finalCardCount`、`cards`
- 状态：`draft`（待完善）、`pending_print`（待打印）、`printed`（已打印）

笼卡打印规则：

- 默认小鼠按 5 只/笼计算建议打印张数，大鼠按 4 只/笼计算。
- 识别完成后，`finalCardCount` 默认等于 `suggestedCardCount`，用户可在打印前修改。
- 数量不能整除时，最后一张笼卡的“数目变化”留空，便于按实收数量手写。
- 打印模板按 A4 纸 2 x 7 版式排列，每张笼卡为 `100mm x 40mm`。

## IACUC 索引

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/iacuc-index` | 读取兼容索引文件 |
| `GET` | `/api/iacuc-index/status` | 查看索引状态 |
| `POST` | `/api/iacuc-index/upload` | 上传 CSV 并重建实验申请表 |
| `GET` | `/api/principal-identities` | 项目负责人身份列表 |
| `PUT` | `/api/principal-identities/{pi}` | 更新项目负责人身份 |

CSV 必须包含：

- `动物伦理编号`
- `动物实验名称`
- `项目负责人`
- `实验负责人`

可选列：

- `项目来源`
- `支撑经费`
- `经费来源`

## 主要数据表

- `rooms`
- `racks`
- `cage_slots`
- `occupancies`
- `experiment_applications`
- `principal_identities`
- `billing_rules`
- `billing_adjustments`
- `quantity_sheets`
- `intake_batches`
- `billing_statements`
- `billing_statement_lines`
- `audit_logs`
- `users`
- `sessions`
- `audit_events`

## 数据保留规则

笼位图表示当前设施结构和当前状态。删除饲养间或笼架时，会删除下级笼架和笼位，但占用记录作为历史流水保留，不再随设施结构级联删除。饲养费结算单由占用记录生成，并保存项目、人员、经费和每日明细快照。

## 后续改进方向

- 增加独立设置接口，服务端保存 `billingMonth`、`billingIacuc` 等用户界面偏好。
- 补充后端批量 API，减少批量录入、批量取材和批量设空时的多次顺序请求。
- 将减免规则管理 UI 接入 `billing-adjustments` 实体 API。
- 结算单增加草稿、确认、导出、作废状态，确认后保存不可变快照。
- 正式长期使用时迁移到 PostgreSQL。
