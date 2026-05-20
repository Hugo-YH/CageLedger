# API 与数据模型

## 系统接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/system/info` | 系统信息 |
| `GET` | `/api/system/update-check` | Gitea 最新 Release 检查 |

## 验证入口

```bash
npm run smoke:api
```

该命令会登录本地服务并检查健康检查、bootstrap、笼卡批次、待进驻任务、数量统计表、结算流程和项目负责人身份接口。

## 认证与账号

| 方法 | 路径 |
| --- | --- |
| `POST` | `/api/auth/login` |
| `POST` | `/api/auth/logout` |
| `GET` | `/api/auth/me` |
| `GET` / `POST` | `/api/users` |
| `PUT` / `DELETE` | `/api/users/{id}` |

## 主要业务接口

| 领域 | 代表接口 |
| --- | --- |
| 设施 | `/api/rooms`、`/api/racks`、`/api/cage-slots` |
| 占用 | `/api/occupancies` |
| 待进驻动物 | `/api/placement-tasks` |
| 数量统计表 | `/api/quantity-sheets`、`/api/quantity-sheets/{id}` |
| 结算 | `/api/billing-statements/generate`、`/api/billing-statements/generate-by-pi` |
| 流程 | `/api/billing-workflows`、`/api/billing-workflows/advance` |
| 审计 | `/api/audit-events` |

### 接收与入驻动作

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/intake-batches/{id}/confirm-receipt` | 确认实际接收并生成待进驻任务 |
| `POST` | `/api/placement-tasks/{id}/reserve` | 为任务预留空笼位 |
| `POST` | `/api/placement-tasks/{id}/move-in` | 将预留占用转为正式入驻 |
| `POST` | `/api/placement-tasks/{id}/reassign-room` | 改签目标饲养间 |

## 数据约束

- IACUC 串联占用、数量统计表和结算链路。
- `funding` 以导入 CSV 中的 `项目来源` 为主。
- 结算流程状态使用月度结算单模型。
- 待进驻任务按每张笼卡生成；预留阶段使用 `reserved`，正式入驻后转为 `active`。
- 数量统计表保存响应包含：

```json
{
  "item": {},
  "affectedItems": [],
  "auditLogs": []
}
```

## 存储模型

后端使用 SQLite，并包含设施、占用、数量统计表、结算流程、负责人身份和审计事件等表。表级访问集中在 `server_app/repositories/`，跨表业务流程集中在 `server_app/services/`。
