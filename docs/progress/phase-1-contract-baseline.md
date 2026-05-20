# Phase 1: Contract Baseline

**Goal**: 建立前后端契约、状态模型、目录分层与迁移顺序
**Status**: Completed

## Tasks

- [x] **Task 1.1**: 定义前端全局状态契约与页面级 state slice
  - Priority: P0
  - Effort: M
  - Acceptance: 状态契约文档覆盖 bootstrap、room、intake、placement、billing、workflow、system
  - Output: `docs/contracts/frontend-state.md`
  - Notes: 以 `src/app.js` 当前真实状态和 lazy loading 入口为准
- [x] **Task 1.2**: 定义核心 API 契约清单
  - Priority: P0
  - Effort: M
  - Acceptance: API contract 文档覆盖 auth、bootstrap、infrastructure、intake、placement、quantity、billing、workflow
  - Output: `docs/contracts/api-contracts.md`
  - Notes: 以 `server.py` 当前 handler 和 service 返回结构为准
- [x] **Task 1.3**: 定义目标目录分层与迁移顺序
  - Priority: P0
  - Effort: S
  - Acceptance: 前后端拆分蓝图、迁移顺序、命名规则和回归要求落盘
  - Output: `docs/contracts/module-boundaries.md`
  - Notes: 后续 Phase 2/3 按契约渐进迁移

## Phase Notes

- Phase 1 只整理契约和边界，业务代码保持原状。
- Phase 2 从后端 config/db/cache/response helper 开始。
- Phase 3 从前端 API client 和 state slices 开始。

## Phase Completion Checklist

- [x] All tasks above are checked off
- [x] MASTER.md phase count updated
- [x] MASTER.md "Current Status" updated to Phase 2
