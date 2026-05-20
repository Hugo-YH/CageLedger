# Task Breakdown

## Overview

- **Total Phases**: 5
- **Total Tasks**: 15
- **Estimated Total Effort**: XL
- **Mode**: LOCAL_ONLY
- **Current Baseline**: `0.5.2c`

## Global S.U.P.E.R Constraints

- **S (Single Purpose)**: 每个新模块只承担一个职责。
- **U (Unidirectional Flow)**: 数据流保持 input -> processing -> output，依赖方向从外层指向内层。
- **P (Ports over Implementation)**: 跨模块 I/O 先落契约，再迁移实现。
- **E (Environment-Agnostic)**: 环境差异通过 env/config/capability 层表达。
- **R (Replaceable Parts)**: 替换单个模块时，调用方只依赖契约。

## Phase 1: Contract Baseline

**Goal**: 建立前后端契约、状态模型、目录分层与迁移边界
**Status**: Completed
**S.U.P.E.R Focus**: P, S, R

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria | Output |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:--------------------|:-------|
| 1.1 | 定义前端全局状态契约与页面级 state slice | P0 | M | — | A | S, P | 状态契约覆盖 bootstrap、room、intake、placement、billing、workflow、system | `docs/contracts/frontend-state.md` |
| 1.2 | 定义核心 API 契约清单 | P0 | M | — | B | P, U | API contract 覆盖 auth、bootstrap、infrastructure、intake、placement、quantity、billing、workflow、system | `docs/contracts/api-contracts.md` |
| 1.3 | 定义目标目录分层与迁移顺序 | P0 | S | 1.1, 1.2 | A | S, R | 目录蓝图、迁移顺序、回滚边界、命名规则落盘 | `docs/contracts/module-boundaries.md` |

## Phase 2: Backend Decomposition

**Goal**: 把 `server.py` 拆成配置层、仓储层、服务层和 HTTP 路由层
**Status**: In Progress
**Prerequisite**: Phase 1 contracts completed
**S.U.P.E.R Focus**: S, U, P, R

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:--------------------|
| 2.1 | 提取配置、连接、缓存与通用响应层 | P0 | M | 1.3 | A | S, E | Completed: backend 基础设施层独立，`server.py` 兼容入口保留，现有 API JSON shape 一致 |
| 2.2 | 提取仓储层：rooms/racks/slots/occupancies/intake/placement/quantity/billing/workflows | P0 | L | 1.2, 2.1 | B | U, P, R | 数据访问集中到 repository helpers，route/service 只依赖 repository contract |
| 2.3 | 提取领域服务层：结算、转入转出、流程推进、待进驻流转 | P0 | L | 2.2 | A | S, U, R | 关键业务逻辑脱离 route 层，写入返回结构与 API contract 一致 |

### Phase 2 Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Write Surface |
|:-----|:------|:----------------|:-----------|:--------------|
| A | 2.1, 2.3 | XL | Medium | `server.py`, future `server_app/config.py`, `server_app/services/*` |
| B | 2.2 | L | Medium | `server.py`, future `server_app/repositories/*` |

## Phase 3: Frontend Decomposition

**Goal**: 把 `src/app.js` 拆成 API、state、domain、view、print 层
**Status**: Planned
**Prerequisite**: Phase 1 contracts and stable API client strategy
**S.U.P.E.R Focus**: S, U, P, R

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:--------------------|
| 3.1 | 提取 API client 和 domain API modules | P0 | M | 1.2 | A | P, R | fetch、401、JSON parse、错误提示归口 |
| 3.2 | 提取状态 slices 和 render scheduler | P0 | L | 1.1 | B | U, S | 状态写入路径映射到 `frontend-state.md` |
| 3.3 | 按业务域拆分 view/action modules | P0 | XL | 3.1, 3.2 | A | S, R | room/intake/placement/billing/workflow/system 视图由模块装配 |

### Phase 3 Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Write Surface |
|:-----|:------|:----------------|:-----------|:--------------|
| A | 3.1, 3.3 | XL | Medium | `src/app.js`, future `src/api/*`, `src/views/*` |
| B | 3.2 | L | Medium | `src/app.js`, future `src/state/*` |

## Phase 4: Validation and Release Hardening

**Goal**: 固化关键契约、核心链路和发布行为的验证门槛
**Status**: Planned
**Prerequisite**: Phase 2 and 3 core extraction complete
**S.U.P.E.R Focus**: P, E, R

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:--------------------|
| 4.1 | 建立核心 API 与迁移回归样本 | P0 | M | 2.3 | A | P, E | 覆盖 IACUC、intake、placement、quantity、billing、workflow、旧库迁移 |
| 4.2 | 建立前端关键路径验收脚本与页面检查清单 | P0 | M | 3.3 | B | U, R | 覆盖首页、笼卡、待进驻、笼位图、结算、流程中心、日志 |
| 4.3 | 固化 release/package/wiki sync contract | P0 | M | 4.1 | A | P, E | 发布顺序、镜像推送、Wiki 同步契约可验证 |

## Phase 5: Documentation and Operating Model Convergence

**Goal**: 让架构、文档、部署、交付和协作流程进入统一规范
**Status**: Planned
**Prerequisite**: core decomposition and validation baseline complete
**S.U.P.E.R Focus**: E, R

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:--------------------|
| 5.1 | 更新 wiki 架构、模块边界、发布与排障文档 | P1 | M | 4.3 | A | E | Wiki 反映最新模块分层与运行方式 |
| 5.2 | 固化项目内执行 skill 与进度追踪规则 | P1 | S | 1.3 | B | R, E | 代理可按项目内 skill 稳定续接工作 |
| 5.3 | 准备重构完成前的汇报和迁移说明模板 | P1 | S | 5.1 | A | E | 能对内说明阶段成果、剩余风险和下一步计划 |

## Execution Rule

Phase 2 从 Task 2.1 开始。每完成一个任务，同步更新 `docs/progress/MASTER.md`、对应 phase 文件和必要的 `wiki/` 页面。
