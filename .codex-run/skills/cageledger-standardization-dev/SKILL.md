# cageledger-standardization-dev

适用于 CageLedger 的规范化改造、模块拆分、契约定义、发布链收敛、验证门槛建设。触发关键词包括：`规范化`、`重构`、`拆分`、`契约`、`模块化`、`架构治理`、`spec-driven`。

## 1. Cross-Conversation Continuity Protocol

Read `docs/progress/MASTER.md` first, always. Identify the tracking mode (`GITEA_FULL`, `GITEA_STANDARD`, or `LOCAL_ONLY`) and the active phase/task, then resume from where the last session left off.

In Gitea modes: After reading MASTER.md, query Gitea for the latest task status. Refresh issue state before continuing, then update MASTER.md if remote state is ahead.

In LOCAL_ONLY mode: `docs/progress/MASTER.md` and `docs/progress/phase-*.md` are the source of truth. Update them after every completed task.

## 2. S.U.P.E.R Architecture Principles (MUST be inlined)

## S.U.P.E.R Architecture — Mandatory Coding Standard

> Write code like building with LEGO — each brick has a single job, a standard interface, a clear direction, runs anywhere, and can be swapped at will.

All code produced in this project MUST conform to these five principles. Violations are treated as bugs.

### S — Single Purpose
- Each module, file, and function solves exactly one problem
- Prefer decomposition; power comes from composition
- **Litmus test**: Can you describe this module's responsibility in a single sentence? If not, split it.

### U — Unidirectional Flow
- Data flows in one direction: input → processing → output
- Dependencies point inward: outer layers depend on inner, inner layers know nothing about outer
- No circular imports, no reverse dependencies
- **Litmus test**: Can the core logic run unit tests with zero external services?

### P — Ports over Implementation
- Define interface contracts (JSON Schema, types, data structures) BEFORE writing implementation
- All cross-module I/O must be serializable
- Swapping a data source, render layer, or notification channel requires zero changes to core logic
- **Practice**: Every module boundary communicates via explicit, schema-defined contracts

### E — Environment-Agnostic
- Configuration via environment variables or config files, never hardcoded
- All dependencies explicitly declared (requirements.txt / package.json / Cargo.toml)
- Processes are stateless; persistence delegated to external storage
- Logs to stdout. Same codebase runs locally, in Docker, on cloud
- **Config precedence**: Environment variables > .env > config file > in-code defaults

### R — Replaceable Parts
- Any layer can be replaced without affecting others
- Replacement cost is THE core metric of architecture quality
- If replacing one component triggers cascading changes, the architecture is broken
- **Validation**: For each module, ask "Can I swap this with a different implementation by only touching this module's directory?"

## 3. S.U.P.E.R Code Review Checklist (mandatory after each task)

## S.U.P.E.R Code Review — Run After Every Task

Before marking any task as complete, verify ALL of the following:

| # | Check | Principle | Pass? |
|:--|:------|:----------|:------|
| 1 | Every new module/file has exactly one responsibility | S | |
| 2 | No function does more than one conceptual thing | S | |
| 3 | Data flows input → processing → output, no reverse deps | U | |
| 4 | No circular imports introduced | U | |
| 5 | Cross-module interfaces are schema-defined (types/contracts) | P | |
| 6 | Module I/O is serializable | P | |
| 7 | No hardcoded paths, URLs, keys, or config values | E | |
| 8 | All new dependencies explicitly declared in dependency file | E | |
| 9 | New modules can be replaced without changes to other modules | R | |
| 10 | All tests pass after the change | — | |

**Scoring**: All pass = ✅ proceed. 1-2 fail = fix before marking complete. 3+ fail = stop and refactor.

## 4. Target Technology Coding Standards

- 前端继续使用原生 HTML/CSS/JavaScript。新文件按功能拆分到 `src/` 下的明确子目录，入口保持轻量。
- 后端继续使用 Python 标准库 HTTP 服务和 SQLite。路由层、仓储层、服务层、契约辅助层分开组织。
- API 契约优先使用显式 JSON shape 文档，前后端共享同一字段命名和可序列化结构。
- 前端错误处理统一走站内通知与站内确认弹层。
- 状态更新统一经过显式 state helper，渲染经过统一调度入口。
- 后端配置统一来源于环境变量和配置 helper，文件路径、端口、仓库地址、令牌变量不散落在业务函数中。
- 发布、打包、Wiki 同步继续走已有脚本和 `.gitea/workflows/*`，所有改动都要保留现有 release contract。
- 验证基线：
  - `npm run check`
  - 需要时补 `python3 -m py_compile ...`
  - 涉及页面行为时验证本地运行实例

## 5. Project-Specific Architecture Context

- 当前最大 S.U.P.E.R 违反点在 `src/app.js` 和 `server.py`。这两个文件承担多重职责，是规范化改造的第一优先级。
- 目标分层模型：
  - Frontend: `app shell -> state -> api client -> domain helpers -> view modules`
  - Backend: `http routes -> service layer -> repository layer -> sqlite/runtime adapters`
- 当前必须优先修复的风险：
  - 结算链隐式契约
  - 本地静态模式与共享模式的行为分支
  - 待接收批次、待进驻任务、流程中心等长链路 UI 与数据链同步
  - 发布、镜像、Wiki 同步语义
- 关键接口契约必须优先固定：
  - `bootstrap summary / room / full`
  - `infrastructure occupancies`
  - `intake-batches`
  - `placement-tasks`
  - `quantity-sheets`
  - `billing-workflows`
  - `billing-statements`
- 关键业务语义必须保持：
  - IACUC 是核心业务键
  - 数量统计表与动态笼位图双入口并存
  - “已取材”和“设为空”语义分离
  - 房间管理员只能操作授权饲养间
  - 更新检查以 Gitea Release 为准

## 6. Progress Update Instructions

Current project mode is `LOCAL_ONLY`.

- Update the checkbox in the active `docs/progress/phase-*.md` file.
- Update completion counts in `docs/progress/MASTER.md`.
- Update the `Current Status` section in `docs/progress/MASTER.md`.
- Run the S.U.P.E.R Code Review Checklist before marking complete.
- Append a row to the `Task Telemetry Log` in `docs/progress/MASTER.md`.

## 7. Parallel Execution Protocol

- Check `docs/plan/task-breakdown.md` for lane assignments before splitting work.
- Parallel work is valid only for tasks in different lanes with no dependency edge.
- Each lane must own a disjoint write surface.
- Merge sequence is deterministic: lower-risk lane first, then higher-risk lane, then full validation.
- After consolidation, update `docs/progress/MASTER.md` and the active phase file.

## 8. Archive Trigger

When all tasks are done in LOCAL_ONLY mode, initiate archive work. Move finalized planning and progress artifacts that are no longer active into `docs/archives/cageledger-standardization/`, while preserving the last complete `MASTER.md` snapshot.

## 9. Post-Task Telemetry (MANDATORY)

## Post-Task Telemetry — Execute After Every Task

After completing a task, BEFORE marking it as done:

### Step 1: Record Actual Effort
Compare your actual experience against the estimated effort from task-breakdown.md:

| Level | Criteria |
|:------|:---------|
| S | < 30 minutes, no unexpected issues |
| M | 30 min – 2 hours, minor surprises |
| L | 2 – 4 hours, or significant unexpected complexity |
| XL | > 4 hours, or required re-thinking approach |

### Step 2: Run S.U.P.E.R Quick Check
Run the S.U.P.E.R Code Review Checklist (§ 3 above). Record the score (passes out of 10).

### Step 3: Count Unplanned Dependencies
Count files, tasks, or external resources you needed but that were not listed in the task's affected files or dependencies.

### Step 4: Write Telemetry
In LOCAL_ONLY mode, append a row to the `Task Telemetry Log` table in `docs/progress/MASTER.md`.

### Step 5: Update Drift Score
In LOCAL_ONLY mode, update the `Adaptive Control State` table in `docs/progress/MASTER.md`.

### Step 6: Check Thresholds

If `drift_score >= threshold_rescope`, halt and return to planning.

If `drift_score >= threshold_replan`, halt and re-enter task decomposition.

If `drift_score >= threshold_annotate`, add a warning note to the next pending task and continue with caution.
