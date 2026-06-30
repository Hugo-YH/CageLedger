# CageLedger 全项目拆分 — Progress Tracker

> **Task**: 严格兼容现有行为，将前后端、样式、脚本和测试拆为领域内分层模块
> **Started**: 2026-06-30
> **Last Updated**: 2026-06-30
> **Mode**: LOCAL_ONLY

## References

- [Project Overview](../analysis/project-overview.md)
- [Module Inventory](../analysis/module-inventory.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Dependency Graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)

## Phase Summary

| Phase | Name                | Tasks | Done | Progress |
| ----- | ------------------- | ----: | ---: | -------: |
| 1     | 行为基线与架构门禁  |     4 |    4 |     100% |
| 2     | 后端平台层          |     4 |    4 |     100% |
| 3     | 后端领域拆分        |     5 |    0 |       0% |
| 4     | 前端领域拆分        |     5 |    0 |       0% |
| 5     | CSS、脚本与测试结构 |     4 |    0 |       0% |
| 6     | 全链路验收与归档    |     4 |    0 |       0% |

## Phase Checklist

- [x] Phase 1: 行为基线与架构门禁 (4/4) — [details](./phase-1-baseline.md)
- [x] Phase 2: 后端平台层 (4/4) — [details](./phase-2-platform.md)
- [ ] Phase 3: 后端领域拆分 (0/5) — [details](./phase-3-backend-domains.md)
- [ ] Phase 4: 前端领域拆分 (0/5) — [details](./phase-4-frontend-domains.md)
- [ ] Phase 5: CSS、脚本与测试结构 (0/4) — [details](./phase-5-assets-tooling.md)
- [ ] Phase 6: 全链路验收与归档 (0/4) — [details](./phase-6-validation.md)

## Current Status

**Active Phase**: Phase 3
**Active Task**: 3.1 拆 administration、audit、system 与 iacuc
**Blockers**: None

## Adaptive Control State

| Phase | Drift | Annotate | Replan | Rescope | Completed |
| ----- | ----: | -------: | -----: | ------: | --------: |
| 1     |     0 |        1 |      2 |       3 |       4/4 |
| 2     |     0 |        1 |      2 |       3 |       4/4 |
| 3     |     0 |        1 |      2 |       3 |       0/5 |
| 4     |     0 |        1 |      2 |       3 |       0/5 |
| 5     |     0 |        1 |      2 |       3 |       0/4 |
| 6     |     0 |        1 |      2 |       3 |       0/4 |

## Task Telemetry Log

| Task | Estimated | Actual | SUPER | Unplanned Deps | Drift | Notes                            |
| ---- | --------- | ------ | ----: | -------------: | ----: | -------------------------------- |
| 1.1  | S         | S      | 10/10 |              0 |     0 | 规格、进度和 Skill 校验完成      |
| 1.2  | L         | S      | 10/10 |              0 |     0 | 业务与 API 特征测试完成          |
| 1.3  | M         | M      | 10/10 |              0 |     0 | 打印与三档视觉契约完成           |
| 1.4  | M         | S      | 10/10 |              0 |     0 | report-only 架构检查完成         |
| 2.1  | L         | M      | 10/10 |              0 |     0 | schema registry、建表与索引完成  |
| 2.2  | L         | M      | 10/10 |              0 |     0 | HTTP 基类、响应与 Router 完成    |
| 2.3  | L         | M      |  9/10 |              0 |     0 | 平台路由切换，领域 fallback 保留 |
| 2.4  | M         | S      | 10/10 |              0 |     0 | server.py 收敛为兼容启动入口     |

## Next Steps

1. 拆 administration、audit、system 与 iacuc。
2. 拆 intake、QR 与 cages/placement。
3. 按 quantity、billing、workflow、reimbursement 顺序清空 legacy。

## Session Log

| Date       | Session | Summary                            |
| ---------- | ------- | ---------------------------------- |
| 2026-06-30 | Initial | 创建拆分分支并建立规格驱动执行资料 |
