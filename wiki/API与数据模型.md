# API 与数据模型

本页覆盖当前主要 API 家族、响应约定和核心数据语义。完整技术契约以 `docs/contracts/api-contracts.md` 为准。

## 通用约定

| 项目 | 约定 |
| --- | --- |
| 认证 | Cookie Session，`GET /api/auth/me` 判断当前用户 |
| 错误形状 | `{ "error": "message" }` |
| 列表形状 | `{ "items": [...], "page": { "limit", "offset", "total", "hasMore" } }` |
| 单对象形状 | `{ "item": {...} }` |
| 审计增量 | 写入接口可返回 `auditLogs`，前端按增量合并 |
| 权限 | `admin` 全局；`room_admin` 按授权房间过滤 |

## 主要 API 家族

### 认证与账号

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/logout` | 登出 |
| `GET` | `/api/auth/me` | 当前用户 |
| `GET` / `POST` | `/api/users` | 查询或创建账号 |
| `PUT` / `DELETE` | `/api/users/{id}` | 更新或删除账号 |

### Bootstrap 与设施

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/bootstrap?scope=summary` | 首页摘要、房间摘要、笼架摘要 |
| `GET` | `/api/bootstrap?scope=room&roomId=...` | 单房间设施、笼位、占用、待进驻任务 |
| `GET` | `/api/bootstrap?scope=full` | 全量共享状态 |
| `POST` | `/api/infrastructure` | 批量写入 rooms / racks / slots / occupancies |
| `GET` | `/api/infrastructure/occupancies` | 结算定向占用读取 |

### 笼卡与待进驻

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/intake-batches` | 分页查询待接收批次 |
| `POST` | `/api/intake-batches` | 新建待接收批次 |
| `PUT` | `/api/intake-batches/{id}` | 更新待接收批次 |
| `DELETE` | `/api/intake-batches/{id}` | 删除待接收批次及相关开放任务 |
| `POST` | `/api/intake-batches/{id}/confirm-receipt` | 确认实际接收并生成待进驻任务 |
| `GET` | `/api/placement-tasks` | 分页查询待进驻任务 |
| `POST` | `/api/placement-tasks/{id}/reserve` | 预留空笼位 |
| `POST` | `/api/placement-tasks/{id}/move-in` | 正式入驻 |
| `POST` | `/api/placement-tasks/{id}/reassign-room` | 改签目标饲养间 |

### 数量统计表与结算

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/quantity-sheets` | 分页查询数量统计表 |
| `GET` | `/api/quantity-sheets/{id}` | 查询单张统计表 |
| `POST` / `PUT` | `/api/quantity-sheets` | 新建或更新统计表 |
| `DELETE` | `/api/quantity-sheets/{id}` | 删除统计表和转移镜像行 |
| `POST` | `/api/quantity-sheets/{id}/generate-statement` | 从统计表生成结算单 |
| `POST` | `/api/billing-statements/generate` | 从动态笼位图生成结算单 |
| `POST` | `/api/billing-statements/generate-by-pi` | 按项目负责人合表生成结算单 |
| `GET` | `/api/reimbursement-records` | 分页查询报销台账主列表 |
| `GET` | `/api/reimbursement-records/{id}` | 查询单条报销台账详情、关联流程和历史滚动 |
| `PUT` | `/api/reimbursement-records/{id}` | 更新经费本号、报销单号、已缴金额和报销状态 |
| `DELETE` | `/api/reimbursement-records/{id}` | 删除独立报销台账记录 |
| `POST` | `/api/reimbursement-records/import-monthly` | 导入历史月汇总 Excel |
| `POST` | `/api/reimbursement-records/import-arrears` | 导入历史欠缴汇算 Excel |
| `GET` | `/api/billing-workflows` | 分页查询流程中心列表 |
| `GET` | `/api/billing-workflows/{id}` | 查询流程详情摘要 |
| `GET` | `/api/billing-workflows/{id}/lines` | 查询指定版本明细 |
| `POST` | `/api/billing-workflows/advance` | 推进流程状态 |
| `DELETE` | `/api/billing-workflows/{id}` | 删除流程 |

### 系统与数据

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/system/info` | 系统信息 |
| `GET` | `/api/system/update-check` | Gitea 最新 Release 检查 |
| `GET` | `/api/iacuc-index` | IACUC 索引载荷 |
| `GET` | `/api/iacuc-index/status` | IACUC 索引状态 |
| `POST` | `/api/iacuc-index/upload` | 上传 CSV 索引 |
| `GET` | `/api/principal-identities` | 查询负责人身份 |
| `PUT` | `/api/principal-identities/{name}` | 更新负责人身份 |
| `GET` | `/api/audit-events` | 查询审计日志 |

## 关键响应形状

### 列表分页

```json
{
  "items": [],
  "page": {
    "limit": 5,
    "offset": 0,
    "total": 12,
    "hasMore": true
  }
}
```

### 数量统计表保存

```json
{
  "sheet": {
    "rows": [
      {
        "date": "2026-05-01",
        "addedCount": 10,
        "addedType": "购入",
        "removedCount": null,
        "removedType": "",
        "animalCount": null,
        "cageCount": null,
        "handler": "经手人",
        "balanceSource": "auto"
      }
    ],
    "pageCount": 1
  },
  "affectedSheets": [],
  "auditLogs": []
}
```

数量统计表前端按纸质表展示固定录入槽位，每页左右两栏各 15 行。左侧第一行固定为当前统计表月份 1 号，仍可记录当日新增和减少，`animalCount` 和 `cageCount` 作为月初结余写入。其他日期输入会在保存前归一为 `YYYY-MM-DD`，支持 `2026/05/15`、`20260515`、`0515`；只输入日号时按当前统计表月份补全年月。`pageCount` 记录同一伦理同月的纸质页数；保存时按日期排序并压缩为有效 `rows`。`handler` 用于记录每日经手人，`balanceSource` 标记结余来自自动计算或人工输入；旧数据缺少这些字段时按默认值处理。

### 流程推进

```json
{
  "workflow": {},
  "event": {},
  "auditLogs": []
}
```

### 报销台账详情

```json
{
  "item": {
    "month": "2026-03",
    "pi": "张三",
    "workflowStatus": "statement_sent",
    "reimbursementStatus": "reimbursing",
    "currentMonthAmount": 1200,
    "supportAmount": 80,
    "payableAmount": 1120,
    "paidAmount": 500,
    "unpaidAmount": 620,
    "accumulatedUnpaid": 3500,
    "fundBookNo": "3030902100001",
    "reimbursementFormNo": "BXD1001202604000001",
    "details": []
  },
  "workflow": {},
  "workflowVersions": [],
  "workflowEvents": [],
  "history": []
}
```

## 核心数据语义

| 对象 | 语义 |
| --- | --- |
| `IACUC` | 串联占用、数量统计表和结算链路的核心业务键 |
| `funding` | 财务来源字段，`项目来源` 是 source of truth |
| `occupancies` | 笼位占用历史，状态重点在 `reserved` 与 `active` |
| `placement_tasks` | 每张已接收笼卡生成一条待进驻任务 |
| `quantity_sheets` | 月度数量统计表，支持伦理号之间转入转出 |
| `reimbursement_records` | 每月每项目负责人一条报销台账，滚动维护应缴、已缴、未缴和报销状态 |
| `billing_workflows` | 月度结算流程，不是单笼位生命周期 |
| `audit_events` | 关键写操作审计记录 |

## 相关页面

- [[项目结构]]
- [[数据管理与IACUC索引]]
- [[饲养费核算]]
