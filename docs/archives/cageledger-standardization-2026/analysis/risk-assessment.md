# Risk Assessment

> Baseline: CageLedger `0.5.2c`

## S.U.P.E.R Architecture Health Summary

| Principle | Status | Key Findings | Transformation Priority |
|:----------|:-------|:-------------|:------------------------|
| **S** Single Purpose | 🔴 | `src/app.js` 和 `server.py` 仍承担跨层复合职责 | High |
| **U** Unidirectional Flow | 🟡 | 主数据流可描述，局部写入、缓存失效、补拉路径需要集中化 | High |
| **P** Ports over Implementation | 🟡 | 本轮新增契约文档，代码层仍待按契约迁移 | High |
| **E** Environment-Agnostic | 🟡 | static/shared/runner/Docker 模式已可用，环境能力边界仍需收敛 | Medium |
| **R** Replaceable Parts | 🔴 | 前端页面、后端服务、仓储和发布链替换成本仍高 | High |

**Overall Health**: `1/5` principles healthy. 当前重点是把已经文档化的契约推进到代码层。

## Risk Matrix

| Risk | Impact | Likelihood | Severity | Mitigation |
|:-----|:-------|:-----------|:---------|:-----------|
| 单文件拆分触发连锁回归 | High | High | Critical | 按契约先抽 API/state/db/service，保持旧入口兼容 |
| 笼卡到待进驻链路状态漂移 | High | Medium | High | 确认接收、任务预留、正式入驻使用同一 service contract |
| 数量统计表转入转出镜像失配 | High | Medium | High | 写入接口返回 `sheet + affectedSheets + auditLogs`，前端局部合并 |
| 结算流程列表和详情不同步 | Medium | Medium | Medium | workflow 写入返回可合并对象和事件增量 |
| 房间管理员权限边界回退 | High | Medium | High | repository/service 层保留 actor 过滤和 roomIds 校验 |
| static/shared 模式行为分裂 | Medium | High | High | state/API 层显式声明 remote/local 分支 |
| Gitea 发布链语义漂移 | High | Medium | High | Phase 4 固化 tag -> release -> package -> wiki sync contract |
| Wiki 与内部 spec docs 混淆 | Medium | Medium | Medium | `wiki/` 面向用户运维，`docs/` 面向改造执行 |

## High-Severity Hotspots

### 1. `src/app.js`

当前同一文件承载 app shell、state、API、view、domain helper、print/export。Phase 3 之前先使用 [Frontend State Contract](../contracts/frontend-state.md) 约束所有写入策略。

### 2. `server.py`

当前同一文件承载 HTTP、schema、migration、repository-like access、service-like workflows。Phase 2 先使用 [API Contracts](../contracts/api-contracts.md) 和 [Module Boundaries](../contracts/module-boundaries.md) 固定迁移顺序。

### 3. Intake -> Placement -> Cage Map

确认接收会生成待进驻任务；预留会创建 `reserved` occupancy；正式入驻会转为 `active` 并成为计费起点。任何拆分都要保留这一条状态链。

### 4. Quantity Sheets -> Billing Workflows

数量统计表保存涉及受影响表、审计日志、结算单和流程中心局部更新。拆分时需要优先保护返回结构与前端合并策略。

### 5. Gitea Release / Package / Wiki

更新检查以最新 Gitea Release 为准；容器镜像与 tag 对应；Wiki 从 `wiki/**` 同步。发布链变更必须同时验证 release package、container package、wiki sync。

## Compatibility Requirements

- SQLite 旧库迁移路径保持可运行。
- IACUC 历史字段、CSV 列别名和 `项目来源 -> funding` 语义保持稳定。
- 数量统计表和动态笼位图双入口保持并存。
- 房间管理员只能访问授权饲养间。
- 系统更新继续读取 Gitea latest Release。
- `wiki/` 继续作为面向用户和运维的正式文档入口。
