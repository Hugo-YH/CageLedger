# Phase 1: Contract Baseline

**Goal**: 建立前后端契约、状态模型、目录分层与迁移顺序
**Status**: In Progress

## Tasks
- [ ] **Task 1.1**: 定义前端全局状态契约与页面级 state slice
  - Priority: P0
  - Effort: M
  - Acceptance: 形成状态契约文档，覆盖 bootstrap、room、intake、billing、workflow、system
  - Notes: 先围绕 `src/app.js` 当前真实结构出契约，避免纸面分层脱离实现
- [ ] **Task 1.2**: 定义核心 API 契约清单
  - Priority: P0
  - Effort: M
  - Acceptance: 形成 API contract 文档，覆盖 auth、bootstrap、infrastructure、intake、billing、workflow
  - Notes: 优先抽高频 API 和跨模块 API
- [ ] **Task 1.3**: 定义目标目录分层与迁移顺序
  - Priority: P0
  - Effort: S
  - Acceptance: 形成前后端拆分蓝图、迁移顺序、命名规则和回归要求
  - Notes: 以低风险渐进迁移为主

## Phase Notes

- 当前阶段先写契约和边界，不直接拆业务实现。
- 结算、转入转出、流程推进、待进驻流转是高风险链路，后续拆分优先保守。

## Phase Completion Checklist
- [ ] All tasks above are checked off
- [ ] MASTER.md phase count updated
- [ ] MASTER.md "Current Status" updated to next phase
