# `server_app/legacy.py` 持续拆分：进度

> **任务**：将 legacy.py 渐进拆分到既有 persistence/domain/service/repository/web 边界，同时保持兼容行为。
> **开始日期**：2026-08-16
> **最近更新**：2026-08-16
> **Mode**：LOCAL_ONLY

## 参考资料

- [项目概览](../analysis/project-overview.md)
- [模块清单](../analysis/module-inventory.md)
- [风险评估](../analysis/risk-assessment.md)
- [任务拆解](../plan/task-breakdown.md)
- [依赖图](../plan/dependency-graph.md)
- [里程碑](../plan/milestones.md)
- [项目 Skill](../skill/SKILL.md)

## 阶段摘要

| 阶段 | 名称                 | 任务 | 完成 | 进度   |
| :--- | :------------------- | ---: | ---: | :----- |
| 1    | 契约护栏             |    2 |    2 | 完成   |
| 2    | 低耦合边界迁移       |    4 |    4 | 完成   |
| 3    | State aggregate 分层 |    3 |    3 | 完成   |
| 4    | 跨域业务事务         |    4 |    4 | 完成   |
| 5    | HTTP composition     |    3 |    3 | 完成   |
| 6    | 兼容收口             |    2 |    2 | 完成   |

## 阶段清单

- [x] Phase 1: 契约护栏 (2/2 tasks) — [详情](./phase-1-contract-guardrails.md)
- [x] Phase 2: 低耦合边界迁移 (4/4 tasks) — [详情](./phase-2-low-coupling-extraction.md)
- [x] Phase 3: State aggregate 分层 (3/3 tasks) — [详情](./phase-3-state-layering.md)
- [x] Phase 4: 跨域业务事务 (4/4 tasks) — [详情](./phase-4-domain-transactions.md)
- [x] Phase 5: HTTP composition (3/3 tasks) — [详情](./phase-5-http-composition.md)
- [x] Phase 6: 兼容收口 (2/2 tasks) — [详情](./phase-6-compatibility-closeout.md)

## 当前状态

**当前阶段**：全部完成

**当前任务**：归档完成

**阻塞项**：无

## 下一步

1. 后续业务开发沿正式 domain/application/repository/web 边界推进。
2. 兼容入口变更继续由 `tests/test_legacy_compatibility.py` 守护。

## Adaptive Control State

| Field              | Value                      |
| :----------------- | :------------------------- |
| drift_score        | 3                          |
| strategy           | domain-application-rescope |
| threshold_annotate | 1                          |
| threshold_replan   | 2                          |
| threshold_rescope  | 2                          |
| total_tasks        | 18                         |
| completed_tasks    | 18                         |
| last_updated       | 2026-08-16                 |

### Task Telemetry Log

| Task ID | Est. | Actual | Δ Effort | SUPER Score | SUPER Δ | Unplanned Deps | Task Drift |
| :------ | :--- | :----- | :------- | :---------- | :------ | :------------- | :--------- |
| T1.1    | S    | S      | 0        | 10/10       | +1      | 0              | 0          |
| T1.2    | M    | S      | -1       | 10/10       | +1      | 0              | 0          |
| T2.1    | M    | M      | 0        | 10/10       | +2      | 0              | 0          |
| T2.2    | L    | M      | -1       | 10/10       | +2      | 0              | 0          |
| T2.3    | S    | S      | 0        | 10/10       | +1      | 0              | 0          |
| T2.4    | M    | M      | 0        | 10/10       | +1      | 1              | 1          |
| T3.1    | L    | M      | -1       | 10/10       | +2      | 1              | 1          |
| T3.2    | L    | M      | -1       | 10/10       | +2      | 1              | 1          |
| T3.3    | XL   | L      | -1       | 10/10       | +2      | 0              | 0          |
| T4.1    | M    | M      | 0        | 10/10       | +2      | 1              | 1          |
| T4.2    | XL   | L      | -1       | 10/10       | +2      | 0              | 0          |
| T4.3    | XL   | L      | -1       | 10/10       | +2      | 0              | 0          |
| T4.4    | XL   | L      | -1       | 10/10       | +2      | 0              | 0          |
| T5.1    | M    | S      | -1       | 10/10       | +1      | 0              | 0          |
| T5.2    | L    | M      | -1       | 10/10       | +2      | 0              | 0          |
| T5.3    | XL   | L      | -1       | 10/10       | +2      | 0              | 0          |
| T6.1    | M    | S      | -1       | 10/10       | +2      | 0              | 0          |
| T6.2    | M    | M      | 0        | 10/10       | +2      | 0              | 0          |

## 会话记录

| 日期       | 内容                                                                                                   |
| :--------- | :----------------------------------------------------------------------------------------------------- |
| 2026-08-16 | 完成分析、任务拆解、LOCAL_ONLY 追踪和项目 Skill 初始化，开始 T1.1。                                    |
| 2026-08-16 | T3.2 完成；累计 drift 达到重规划阈值，T3.3 改为四个事务切片串行迁移。                                  |
| 2026-08-16 | Phase 3 完成；179 项 Python 测试与 architecture enforce 通过，进入 Phase 4。                           |
| 2026-08-16 | T4.1 完成；累计 drift 达到 rescope 阈值，后续跨域事务按 application module 与显式 submodule 入口迁移。 |
| 2026-08-16 | 六阶段全部完成；legacy 收敛为 101 行兼容层，完整检查、179 项 Python 测试与 8 项 API smoke 通过。  |
