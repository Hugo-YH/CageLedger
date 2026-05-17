# API 与数据模型

## 系统接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/system/info` | 系统信息 |
| `GET` | `/api/system/update-check` | Gitea 最新 Release 检查 |

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
| 数量统计表 | `/api/quantity-sheets`、`/api/quantity-sheets/{id}` |
| 结算 | `/api/billing-statements/generate`、`/api/billing-statements/generate-by-pi` |
| 流程 | `/api/billing-workflows`、`/api/billing-workflows/advance` |
| 审计 | `/api/audit-events` |

## 数据约束

- IACUC 串联占用、数量统计表和结算链路。
- `funding` 以导入 CSV 中的 `项目来源` 为主。
- 结算流程状态使用月度结算单模型。
- 数量统计表保存响应包含：

```json
{
  "item": {},
  "affectedItems": [],
  "auditLogs": []
}
```

## 存储模型

后端使用 SQLite，并包含设施、占用、数量统计表、结算流程、负责人身份和审计事件等表。
