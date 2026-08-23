# Risk Assessment

## S.U.P.E.R Architecture Health Summary

| Principle                | Status | Key Findings                          | Priority |
| :----------------------- | :----- | :------------------------------------ | :------- |
| S — Single Purpose       | 🔴     | 页面和后端系统模块职责过多            | High     |
| U — Unidirectional Flow  | 🟢     | UI → hook → API → snapshot 数据流清晰 | Medium   |
| P — Ports                | 🔴     | TypeScript 契约遗漏 `performance`     | High     |
| E — Environment-Agnostic | 🟡     | 页面硬编码证书部署信息                | Medium   |
| R — Replaceable Parts    | 🔴     | 页面 CSS 跨三个文件覆盖               | High     |

**Overall Health**: 1/5 healthy — 本次优先修复页面、契约和样式边界，不扩大为整个 system domain 的重构。

## Risk Matrix

| Risk                         | Impact | Likelihood | Mitigation                                             |
| :--------------------------- | :----- | :--------- | :----------------------------------------------------- |
| 指标被误读为长期监控         | High   | High       | 明示“当前服务进程”，展示运行时长和刷新时间，不画趋势图 |
| 性能契约漂移                 | High   | High       | 先补完整 TypeScript 类型和 API 文档                    |
| 低权限用户看到运维数据       | High   | Low        | 保持后端 admin-only，前端按角色禁用查询和隐藏指标      |
| 页面刷新污染请求计数         | Medium | High       | 仅手动刷新，不启用高频轮询                             |
| CSS 多重归属继续覆盖         | High   | High       | 删除旧规则，统一到 administration owner，并登记组件族  |
| 删除公共系统信息引发页脚回归 | High   | Medium     | 保留 `/api/system/info`，只精简页面展示                |
| 既有脏改动被覆盖             | High   | Medium     | 仅增量编辑重叠文件，不回退现有性能优化                 |

## Testing Risks

需新增或扩展：指标格式化单测、管理员/普通角色可见性、刷新状态、空样本、四档视口、无横向溢出与 Axe serious/critical 检查。

## Project Governance Risks

现有 `AGENTS.md` 与 `docs/contracts/` 足以承载稳定规则；不得新增竞争性的项目记忆文件。

## Compatibility Concerns

不删除 `/api/system/info` 或 `/api/system/environment`，不改变现有权限与响应字段，只补齐前端消费和文档说明。
