# Module Inventory

| Module                        | Responsibility                 | Dependencies                 | Complexity | S.U.P.E.R Score     |
| :---------------------------- | :----------------------------- | :--------------------------- | :--------- | :------------------ |
| `SystemView.tsx`              | 产品信息、状态、证书和主题入口 | antd、Query hooks、UI state  | High       | S🔴 U🟢 P🟡 E🔴 R🔴 |
| `contracts/administration.ts` | 系统 API 类型                  | TypeScript                   | Medium     | S🟢 U🟢 P🔴 E🟢 R🟡 |
| `api/administration.ts`       | 系统数据查询                   | TanStack Query               | Low        | S🟡 U🟢 P🟡 E🟢 R🟢 |
| `administration/system.py`    | 元数据、环境、更新与状态聚合   | config、SQLite、cache、Gitea | High       | S🔴 U🟡 P🟡 E🟡 R🔴 |
| `performance.py`              | 低开销进程指标                 | threading、deque             | Low        | S🟢 U🟢 P🟡 E🟢 R🟢 |
| 系统页 CSS                    | 页面布局与响应式               | shell/antd/admin 样式级联    | High       | S🔴 U🟡 P🟡 E🟢 R🔴 |

## Module Details

### SystemView

- **Public API**: `SystemView({ user, navigate })`
- **Current issue**: 单组件混合产品身份、更新、环境、证书和主题，标题层级与数据状态相互耦合。
- **Target**: 拆为单责展示组件，顶层只编排查询与角色边界。

### Administration contracts and hooks

- **Public API**: `SystemInfo`、`SystemEnvironment`、`useSystemInfo`、`useSystemEnvironment`。
- **Current issue**: 后端已返回 `performance`，前端契约遗漏。
- **Target**: 显式定义可序列化的请求、缓存、数据库与阈值结构；保持管理员接口权限不变。

### Backend performance

- **Public API**: `record_request`、`record_cache`、`record_database_operation`、`performance_snapshot`。
- **Semantics**: 指标随进程重启清零；延迟最多保留 512 个样本；缓存命中率分母为命中、未命中和过期。
- **Target**: UI 准确表达累计口径，不伪装为长期 SLA 或趋势监控。

### Styles

- **Current issue**: `.system-layout` 分散在 `shell.css`、`antd-system.css`、`administration.css`。
- **Target**: 系统页布局唯一归属 `administration.css`，并登记 `system-status-page` 组件族。
