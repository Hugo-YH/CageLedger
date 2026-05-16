# API 和数据模型

CageLedger 的共享模式由 `server.py` 提供 HTTP API。后端使用 SQLite 存储，写入操作会执行权限校验并记录审计事件。

## 健康检查与系统信息

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 返回服务、数据库和系统信息 |
| `GET` | `/api/system/info` | 返回版本、单位、版权和仓库信息 |
| `GET` | `/api/system/update-check` | 返回 Gitea 远端更新检查状态；默认关闭 |

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

## 前端通知与确认规范

系统前端统一使用站内通知和站内确认弹层，不再使用浏览器原生 `alert()` 或 `confirm()`。

### 站内通知接口

前端通知入口：

```js
showFlashNotice(title, message, type = "success")
```

参数说明：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 通知标题，建议控制在 4-8 个汉字 |
| `message` | `string` | 通知正文，支持换行展示 |
| `type` | `success` / `warning` / `error` | 通知类型，默认 `success` |

通知类型：

| 类型 | 使用场景 | 自动消失 |
| --- | --- | --- |
| `success` | 保存成功、删除成功、流程发起成功、上传完成 | 约 3.2 秒 |
| `warning` | 表单缺项、业务校验未通过、需要用户处理但数据未损坏 | 约 4.2 秒 |
| `error` | 网络失败、接口失败、保存失败、浏览器阻止弹窗 | 约 4.2 秒 |

使用示例：

```js
showFlashNotice("保存成功", `已保存为待接收批次：${batchNo}`);
showFlashNotice("无法保存待接收批次", "请先完善 接收日期。", "warning");
showFlashNotice("保存失败", error.message || "保存失败", "error");
```

设计规则：

- 通知固定悬浮在工作区右上角，不占用页面文档流。
- 同一时间只展示一条通知，新的通知会替换旧通知。
- 通知内容不写入本地缓存，刷新后不保留。
- 后续新增功能的成功、警告、错误提示统一走 `showFlashNotice(...)`。

### 站内确认弹层接口

前端确认入口：

```js
openConfirmDialog({
  type,
  id,
  title,
  message,
  confirmLabel,
  payload,
})
```

参数说明：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `type` | `string` | 确认动作类型，用于 `handleConfirmDialogAction()` 分发 |
| `id` | `string` | 目标实体 ID |
| `title` | `string` | 弹层标题 |
| `message` | `string` | 确认说明 |
| `confirmLabel` | `string` | 主操作按钮文案 |
| `payload` | `object` | 临时上下文，例如显示名称、日期等 |

当前确认动作类型：

| 类型 | 业务动作 |
| --- | --- |
| `delete-intake-batch` | 删除待接收批次 |
| `delete-workflow` | 删除结算流程 |
| `delete-user` | 删除账号 |
| `sample-batch-slots` | 批量标记已取材 |
| `clear-batch-slots` | 批量设为空 |
| `delete-room` | 删除饲养间 |
| `delete-rack` | 删除笼架 |

使用示例：

```js
openConfirmDialog({
  type: "delete-intake-batch",
  id: batchId,
  title: "删除待接收批次",
  message: `确认删除待接收批次 ${batchNo}？`,
  confirmLabel: "删除",
  payload: { batchNo },
});
```

确认弹层规则：

- 危险操作统一使用站内确认弹层。
- 确认后由 `handleConfirmDialogAction()` 执行业务动作。
- 成功后继续调用 `showFlashNotice(...)` 给出结果反馈。
- 弹层状态不写入本地缓存，刷新后不保留。

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

### 列表分页与筛选

部分列表接口支持分页和筛选参数；未传参数时保持原有列表返回结构，响应中额外带 `page` 元数据。

通用分页参数：

| 参数 | 说明 |
| --- | --- |
| `limit` | 返回条数，普通列表最大 10000，审计日志最大 1000 |
| `offset` | 起始偏移量 |

分页响应：

```json
{
  "items": [],
  "page": {
    "limit": 200,
    "offset": 0,
    "total": 521,
    "hasMore": true
  }
}
```

当前支持筛选的接口：

| 接口 | 筛选参数 |
| --- | --- |
| `GET /api/audit-events` | `entityType`、`action`、`limit`、`offset` |
| `GET /api/intake-batches` | `status`、`month`、`iacuc`、`roomName`、`limit`、`offset` |
| `GET /api/quantity-sheets` | `month`、`iacuc`、`pi`、`roomId`、`limit`、`offset` |
| `GET /api/billing-workflows` | `month`、`status`、`sourceType`、`iacuc`、`limit`、`offset` |

示例：

```http
GET /api/intake-batches?status=pending&month=2026-05&limit=50&offset=0
GET /api/billing-workflows?status=statement_generated&limit=20
GET /api/audit-events?entityType=cage_slot&limit=100
```

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
- 打印时 `supplier` 原始值仍保存完整名称，笼卡“购买单位”按内置供应商简称规则显示，例如江苏集萃药康生物科技股份有限公司显示为“江苏集萃”。
- 打印日期统一使用短横线格式：接收日期为 `YYYY-MM-DD`，饲养周期为紧凑日期范围。

预约消息识别规则：

- 支持 `锐竞采购单号`、`锐竟采购订单编号`、`锐竞单号为` 等采购单号写法。
- 支持全角括号批次号、字段后带 `为`、无冒号字段、供应商/品系/数量在连续文本中的识别。
- 支持 `YYYY.MM.DD`、`YYYY年M月D日`、`YYYY/M/D`、`YY/M/D`、`M月D日/号` 等接收日期格式；无年份日期优先从批次号后半段或采购单号推断年份。

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

### `occupancies` 结构化字段

`occupancies` 保留完整 `payload` 快照，同时把高频查询字段拆成结构化列，方便筛选、计费和统计报表直接走 SQL。

| 字段 | 说明 |
| --- | --- |
| `slot_id` | 笼位 ID |
| `room_id` | 饲养间 ID |
| `rack_id` | 笼架 ID |
| `cage_code` | 笼位完整编号 |
| `status` | 占用状态 |
| `iacuc` | IACUC 编号 |
| `project` | 项目名称 |
| `pi` | 项目负责人 |
| `owner` | 实验负责人 |
| `funding` | 支撑经费 |
| `species` | 动物种类 |
| `billing_item` | 收费项目 |
| `customer_type` | 院内/院外 |
| `animal_count` | 动物数量 |
| `room_name` | 饲养间名称快照 |
| `rack_name` | 笼架名称快照 |
| `slot_code` | 笼位位置快照 |
| `start_date` | 开始日期 |
| `end_date` | 结束/最后计费日期 |
| `end_reason` | 结束原因 |
| `updated_at` | 更新时间 |
| `payload` | 完整业务快照 |

## 数据保留规则

笼位图表示当前设施结构和当前状态。删除饲养间或笼架时，会删除下级笼架和笼位，但占用记录作为历史流水保留，不再随设施结构级联删除。饲养费结算单由占用记录生成，并保存项目、人员、经费和每日明细快照。

## 后续改进方向

- 增加独立设置接口，服务端保存 `billingMonth`、`billingIacuc` 等用户界面偏好。
- 补充后端批量 API，减少批量录入、批量取材和批量设空时的多次顺序请求。
- 将减免规则管理 UI 接入 `billing-adjustments` 实体 API。
- 结算单增加草稿、确认、导出、作废状态，确认后保存不可变快照。
- 正式长期使用时迁移到 PostgreSQL。
