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
| 3     | 后端领域拆分        |     5 |    5 |     100% |
| 4     | 前端领域拆分        |     5 |    5 |     100% |
| 5     | CSS、脚本与测试结构 |     4 |    4 |     100% |
| 6     | 全链路验收与归档    |     4 |    0 |       0% |

## Phase Checklist

- [x] Phase 1: 行为基线与架构门禁 (4/4) — [details](./phase-1-baseline.md)
- [x] Phase 2: 后端平台层 (4/4) — [details](./phase-2-platform.md)
- [x] Phase 3: 后端领域拆分 (5/5) — [details](./phase-3-backend-domains.md)
- [x] Phase 4: 前端领域拆分 (5/5) — [details](./phase-4-frontend-domains.md)
- [x] Phase 5: CSS、脚本与测试结构 (4/4) — [details](./phase-5-assets-tooling.md)
- [ ] Phase 6: 全链路验收与归档 (0/4) — [details](./phase-6-validation.md)

## Current Status

**Active Phase**: Phase 6
**Active Task**: 6.1 旧库与完整业务链验证
**Blockers**: None

## Adaptive Control State

| Phase | Drift | Annotate | Replan | Rescope | Completed |
| ----- | ----: | -------: | -----: | ------: | --------: |
| 1     |     0 |        1 |      2 |       3 |       4/4 |
| 2     |     0 |        1 |      2 |       3 |       4/4 |
| 3     |     0 |        1 |      2 |       3 |       5/5 |
| 4     |     0 |        1 |      2 |       3 |       5/5 |
| 5     |     0 |        1 |      2 |       3 |       4/4 |
| 6     |     0 |        1 |      2 |       3 |       0/4 |

## Task Telemetry Log

| Task | Estimated | Actual | SUPER | Unplanned Deps | Drift | Notes                             |
| ---- | --------- | ------ | ----: | -------------: | ----: | --------------------------------- |
| 1.1  | S         | S      | 10/10 |              0 |     0 | 规格、进度和 Skill 校验完成       |
| 1.2  | L         | S      | 10/10 |              0 |     0 | 业务与 API 特征测试完成           |
| 1.3  | M         | M      | 10/10 |              0 |     0 | 打印与三档视觉契约完成            |
| 1.4  | M         | S      | 10/10 |              0 |     0 | report-only 架构检查完成          |
| 2.1  | L         | M      | 10/10 |              0 |     0 | schema registry、建表与索引完成   |
| 2.2  | L         | M      | 10/10 |              0 |     0 | HTTP 基类、响应与 Router 完成     |
| 2.3  | L         | M      |  9/10 |              0 |     0 | 平台路由切换，领域 fallback 保留  |
| 2.4  | M         | S      | 10/10 |              0 |     0 | server.py 收敛为兼容启动入口      |
| 3.1  | L         | M      |  9/10 |              0 |     0 | 管理、审计、系统与 IACUC 领域完成 |
| 3.2  | L         | M      |  9/10 |              0 |     0 | intake、QR 与笼位 service 归域    |
| 3.3  | L         | M      | 10/10 |              0 |     0 | 数量统计 service/repository 拆分  |
| 3.4  | L         | L      |  9/10 |              0 |     0 | 计费规则与流程 repository 拆分    |
| 3.5  | L         | M      |  9/10 |              0 |     0 | 报销 service 与 Excel 解析归域    |
| 4.1  | M         | M      | 10/10 |              0 |     0 | API contracts 分域且兼容导出      |
| 4.2  | L         | M      | 10/10 |              0 |     0 | 数量统计 View 与三类组件拆分      |
| 4.3  | L         | M      | 10/10 |              0 |     0 | 笼位与笼卡 View 拆分              |
| 4.4  | M         | S      | 10/10 |              0 |     0 | 流程、房间页面与 model 拆分       |
| 4.5  | S         | S      | 10/10 |              0 |     0 | release notes 历史记录拆分        |
| 5.1  | L         | M      | 10/10 |              0 |     0 | CSS 按原始级联顺序拆分            |
| 5.2  | M         | S      | 10/10 |              0 |     0 | 精确重复规则清理且视觉契约通过    |
| 5.3  | M         | S      | 10/10 |              0 |     0 | demo、发布记录和 E2E 分域拆分     |
| 5.4  | M         | S      | 10/10 |              0 |     0 | 强制架构检查接入 npm check        |

## Next Steps

1. 拆 reimbursement Excel 导入并切换领域路由。
2. 完成 Query hooks 与大型 React View 拆分。
3. 按现有级联顺序拆分 CSS。

## Session Log

| Date       | Session | Summary                            |
| ---------- | ------- | ---------------------------------- |
| 2026-06-30 | Initial | 创建拆分分支并建立规格驱动执行资料 |
