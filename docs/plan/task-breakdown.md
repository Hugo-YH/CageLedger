# Task Breakdown

## Overview
- **Total Phases**: 5
- **Total Tasks**: 15
- **Estimated Total Effort**: XL

## S.U.P.E.R Design Constraints

> All tasks in this plan must produce code that conforms to S.U.P.E.R architecture principles. The following constraints apply globally:

- **S (Single Purpose)**: Each new module/file/function solves exactly one problem. If a task spans multiple responsibilities, decompose it further.
- **U (Unidirectional Flow)**: Data flows input → processing → output. Dependencies point inward. No circular imports.
- **P (Ports over Implementation)**: Define interface contracts (schemas, types) before implementation. All cross-module I/O must be serializable.
- **E (Environment-Agnostic)**: No hardcoded config. All env-specific values from environment variables or config files.
- **R (Replaceable Parts)**: Each component must be replaceable without cascading changes. Validate with the replacement test: "Can I swap this with a different implementation by only touching this module?"

## Phase 1: Contract Baseline
**Goal**: 建立前后端契约、状态模型、目录分层与改造边界
**Prerequisite**: 现有业务流程可运行，分析文档已完成
**S.U.P.E.R Focus**: P — 先定义接口和状态契约； S — 明确模块职责

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:--------------------|
| 1.1 | 定义前端全局状态契约与页面级 state slice | P0 | M | — | A | S, P | 形成状态契约文档，覆盖 bootstrap、billing、intake、workflow |
| 1.2 | 定义核心 API 契约清单 | P0 | M | — | B | P, U | 形成 API contract 文档，覆盖 auth、bootstrap、infrastructure、billing、workflow |
| 1.3 | 定义目标目录分层与迁移顺序 | P0 | S | 1.1, 1.2 | A | S, R | 形成目录蓝图和迁移规则，明确前后端拆分边界 |

### Parallel Lanes
| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:-----|:------|:----------------|:-----------|:----------|
| A | 1.1, 1.3 | L | Low | `src/app.js`, `docs/*` |
| B | 1.2 | M | Low | `server.py`, `docs/*` |

## Phase 2: Backend Decomposition
**Goal**: 把 `server.py` 拆成路由、仓储、服务、契约辅助层
**Prerequisite**: Phase 1 contracts and target directories approved
**S.U.P.E.R Focus**: S, U, R

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:--------------------|
| 2.1 | 提取配置、连接、缓存与通用响应层 | P0 | M | 1.3 | A | S, E | backend 基础设施层独立，现有 API 行为一致 |
| 2.2 | 提取仓储层：rooms/racks/slots/occupancies/intake/billing/workflows | P0 | L | 1.2, 2.1 | B | U, P, R | 数据访问集中到 repository helpers，HTTP route 不再直接拼 SQL |
| 2.3 | 提取领域服务层：结算、转入转出、流程推进、待进驻流转 | P0 | L | 2.2 | A | S, U, R | 关键业务逻辑从 route 层分离，回归通过 |

### Parallel Lanes
| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:-----|:------|:----------------|:-----------|:----------|
| A | 2.1, 2.3 | XL | Medium | `server.py`, `server/*` |
| B | 2.2 | L | Medium | `server.py`, `server/*` |

## Phase 3: Frontend Decomposition
**Goal**: 把 `src/app.js` 拆成状态层、API 层、视图层、领域 helpers
**Prerequisite**: Phase 1 contracts and initial backend boundaries available
**S.U.P.E.R Focus**: S, U, P, R

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:--------------------|
| 3.1 | 提取 API client 和 request helpers | P0 | M | 1.2 | A | P, R | fetch 调用统一归口，错误和通知入口一致 |
| 3.2 | 提取状态管理层和 render scheduler | P0 | L | 1.1 | B | U, S | 页面状态更新路径清晰，render 入口收敛 |
| 3.3 | 按业务域拆分视图与动作：room/intake/billing/workflow/system | P0 | XL | 3.1, 3.2 | A | S, R | 大模块视图与动作分离，主入口只负责装配 |

### Parallel Lanes
| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:-----|:------|:----------------|:-----------|:----------|
| A | 3.1, 3.3 | XL | Medium | `src/app.js`, `src/*` |
| B | 3.2 | L | Medium | `src/app.js`, `src/*` |

## Phase 4: Validation and Release Hardening
**Goal**: 给关键契约、核心链路和发布行为补验证门槛
**Prerequisite**: Phase 2 and 3 core extraction complete
**S.U.P.E.R Focus**: P, E, R

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:--------------------|
| 4.1 | 建立核心 API 与迁移回归样本 | P0 | M | 2.3 | A | P, E | 覆盖 IACUC、intake、billing、workflow 和旧库兼容 |
| 4.2 | 建立前端关键路径验收脚本与页面检查清单 | P0 | M | 3.3 | B | U, R | 覆盖首页、笼卡、待进驻、结算、流程中心 |
| 4.3 | 固化 release / package / wiki sync contract | P0 | M | 4.1 | A | P, E | 发布顺序、镜像推送、Wiki 同步契约文档化并可验证 |

### Parallel Lanes
| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:-----|:------|:----------------|:-----------|:----------|
| A | 4.1, 4.3 | L | Low | `server/*`, `scripts/*`, `.gitea/*`, `wiki/*` |
| B | 4.2 | M | Low | `src/*`, docs |

## Phase 5: Documentation and Operating Model Convergence
**Goal**: 让架构、文档、部署、交付和协作流程进入统一规范
**Prerequisite**: core decomposition and validation baseline complete
**S.U.P.E.R Focus**: E, R

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:--------------------|
| 5.1 | 更新 wiki 架构、模块边界、发布与排障文档 | P1 | M | 4.3 | A | E | Wiki 能反映最新模块分层与运行方式 |
| 5.2 | 固化项目内执行 skill 与进度追踪规则 | P1 | S | 1.3 | B | R, E | 代理可按项目内 skill 稳定续接工作 |
| 5.3 | 准备重构完成前的汇报和迁移说明模板 | P1 | S | 5.1 | A | E | 能对内说明阶段成果、剩余风险和下一步计划 |

### Parallel Lanes
| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:-----|:------|:----------------|:-----------|:----------|
| A | 5.1, 5.3 | M | Low | `wiki/*`, docs |
| B | 5.2 | S | Low | `docs/progress/*`, `.codex/skills/*` |
