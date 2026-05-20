# CageLedger Standardization — Progress Tracker

> **Task**: 按 spec-driven-develop 规范化 CageLedger 的架构、进度控制和后续改造路径
> **Started**: 2026-05-20
> **Last Updated**: 2026-05-21
> **Mode**: LOCAL_ONLY
> **Baseline Version**: 0.5.2c

## References

- [Project Overview](../analysis/project-overview.md)
- [Module Inventory](../analysis/module-inventory.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Frontend State Contract](../contracts/frontend-state.md)
- [API Contracts](../contracts/api-contracts.md)
- [Module Boundaries](../contracts/module-boundaries.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Dependency Graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)

## Phase Summary

| Phase | Name | Tasks | Done | Progress |
|:------|:-----|------:|-----:|:---------|
| 1 | Contract Baseline | 3 | 3 | 100% |
| 2 | Backend Decomposition | 3 | 3 | 100% |
| 3 | Frontend Decomposition | 3 | 3 | 100% |
| 4 | Validation and Release Hardening | 3 | 3 | 100% |
| 5 | Documentation and Operating Model Convergence | 3 | 3 | 100% |

## Phase Checklist

- [x] Phase 1: Contract Baseline (3/3 tasks) — [details](./phase-1-contract-baseline.md)
- [x] Phase 2: Backend Decomposition (3/3 tasks) — [details](./phase-2-backend-decomposition.md)
- [x] Phase 3: Frontend Decomposition (3/3 tasks) — [details](./phase-3-frontend-decomposition.md)
- [x] Phase 4: Validation and Release Hardening (3/3 tasks) — [details](./phase-4-validation-and-release-hardening.md)
- [x] Phase 5: Documentation and Operating Model Convergence (3/3 tasks) — [details](./phase-5-documentation-and-operating-model-convergence.md)

## Current Status

**Active Phase**: Complete
**Active Task**: v0.5.3 发布验证
**Blockers**: None
**Entry Contracts**: `docs/contracts/frontend-state.md`, `docs/contracts/api-contracts.md`, `docs/contracts/module-boundaries.md`

## Adaptive Control State

| Metric | Value |
|:-------|------:|
| completed_tasks | 15 |
| drift_score | 0 |
| threshold_annotate | 4 |
| threshold_replan | 7 |
| threshold_rescope | 10 |

## Next Steps

1. 执行 `npm run release:local -- --version 0.5.3 --push`。
2. 确认 Gitea Release、Container Registry 和 Wiki 同步工作流完成。
3. 发布后保留 `docs/progress/MASTER.md` 作为完整整理基线。

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-05-20 | 1 | 初始化 spec-driven 规范化骨架，产出分析、计划、进度主控和项目内执行 skill 基线。 |
| 2026-05-20 | 2 | 完成 Phase 1 契约整理，新增 frontend-state、api-contracts、module-boundaries，并把计划与进度推进到 Phase 2。 |
| 2026-05-20 | 3 | 完成 Phase 2 Task 2.1，新增 `server_app/config.py`、`db.py`、`cache.py`、`http.py`，保留 `server.py` 兼容入口。 |
| 2026-05-20 | 4 | 推进 Phase 2 Task 2.2 第一批仓储拆分，新增通用 payload/settings 分页仓储和 infrastructure 写入仓储。 |
| 2026-05-20 | 5 | 推进 Phase 2 Task 2.2 第二批仓储拆分，新增 users、audit、iacuc、entities 仓储并完成 principal/intake/placement/audit 接口冒烟。 |
| 2026-05-20 | 6 | 推进 Phase 2 Task 2.2 第三批仓储拆分，新增 billing/state 只读仓储并完成 bootstrap、quantity sheets、billing workflows 接口冒烟。 |
| 2026-05-20 | 7 | 推进 Phase 2 Task 2.2 第四批仓储拆分，新增 quantity sheets 与 billing workflow 写入仓储，`server.py` 改为通过 repository helper 处理删除、版本、事件和转入转出同步相关 SQL。 |
| 2026-05-20 | 8 | 推进 Phase 2 Task 2.2 第五批仓储拆分，补充 principal identity 聚合仓储，项目负责人名单和身份映射改由 repository 提供。 |
| 2026-05-20 | 9 | 开始 Phase 2 Task 2.3 第一批服务拆分，新增 `server_app/services/quantity.py` 与 `server_app/services/billing.py`，把 quantity transfer sync、billing workflow 生成与推进改成 service orchestration。 |
| 2026-05-20 | 10 | 推进 Phase 2 Task 2.3 第二批服务拆分，新增 `server_app/services/intake.py` 与 `server_app/services/placement.py`，把 intake receipt、placement reserve / move-in / reassign 全部迁入 service 层。 |
| 2026-05-21 | 11 | 推进 Phase 2 Task 2.3 收口，新增 service dependency helper，`server.py` 的 intake / placement / quantity / billing service 组装集中化，后续继续迁移结算单生成入口。 |
| 2026-05-21 | 12 | 完成 Phase 3 前端模块边界，新增 `src/api/`、`src/state/`、`src/domain/`、`src/views/`、`src/print/`，并把 API URL 构造接入主入口。 |
| 2026-05-21 | 13 | 完成 Phase 4 验证硬化，新增 `scripts/smoke_api.mjs` 和 `npm run smoke:api`。 |
| 2026-05-21 | 14 | 完成 Phase 5 文档与协作收敛，更新 Wiki、项目 skill、进度追踪和 `SYSTEM_RELEASE_NOTES`，准备发布 `v0.5.3`。 |

## Task Telemetry Log

| Date | Task | Estimated | Actual | SUPER Score | Unplanned Deps | Drift Delta | Notes |
|:-----|:-----|:----------|:-------|:------------|:---------------|:------------|:------|
| 2026-05-20 | Phase 0 基线文档建立 | M | M | 9/10 | 0 | 0 | 建立规范化追踪基线，后续任务按 phase 文件推进。 |
| 2026-05-20 | Task 1.1 前端状态契约 | M | M | 10/10 | 0 | 0 | 契约覆盖 bootstrap、room、intake、placement、quantity、billing、workflow、system。 |
| 2026-05-20 | Task 1.2 API 契约清单 | M | M | 10/10 | 0 | 0 | 契约覆盖 auth、bootstrap、infrastructure、intake、placement、quantity、billing、workflow、system。 |
| 2026-05-20 | Task 1.3 模块边界与迁移顺序 | S | S | 10/10 | 0 | 0 | 固定前后端目标目录、迁移顺序、回滚边界和命名规则。 |
| 2026-05-20 | Task 2.1 后端基础设施层 | M | M | 10/10 | 0 | 0 | 配置、数据库连接、缓存、JSON 响应 helper 已抽到 `server_app/`，API 行为保持兼容。 |
| 2026-05-20 | Task 2.2 仓储层第四批 | M | M | 9/10 | 0 | 0 | 数量统计表和结算流程的写入 SQL 已迁入 `server_app/repositories/billing.py`，路由冒烟通过。 |
| 2026-05-20 | Task 2.2 仓储层第五批 | S | S | 9/10 | 0 | 0 | principal identity 的名单聚合与类型映射已迁入 `server_app/repositories/entities.py`，`/api/principal-identities` 冒烟通过。 |
| 2026-05-20 | Task 2.3 服务层第一批 | M | M | 9/10 | 0 | 0 | quantity transfer sync、billing workflow 生成、workflow status 推进已迁入 `server_app/services/`，现有接口冒烟通过。 |
| 2026-05-20 | Task 2.3 服务层第二批 | M | M | 9/10 | 0 | 0 | intake receipt、placement reserve / move-in / reassign 已迁入 `server_app/services/`，相关列表与登录链路冒烟通过。 |
| 2026-05-21 | Task 2.3 服务层收口 | S | S | 9/10 | 0 | 0 | service dependency helper 已集中到 `server.py`，领域入口更薄，便于下一步继续迁移结算单生成逻辑。 |
| 2026-05-21 | Task 3.1-3.3 前端模块边界 | L | M | 8/10 | 0 | 0 | API、state、domain、views、print 目录已建立，API URL builder 与状态常量接入入口。 |
| 2026-05-21 | Task 4.1-4.3 验证与发布硬化 | M | S | 9/10 | 0 | 0 | 新增 API smoke 脚本，发布前检查命令写入 Wiki，release/package/wiki sync 规则完成文档化。 |
| 2026-05-21 | Task 5.1-5.3 文档与协作收敛 | M | S | 9/10 | 0 | 0 | Wiki、项目 skill、进度追踪和发布说明完成 v0.5.3 收敛。 |
