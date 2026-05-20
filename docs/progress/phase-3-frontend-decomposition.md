# Phase 3: Frontend Decomposition

**Goal**: 把 `src/app.js` 拆成 API、state、view、domain helper 四层
**Status**: Not Started

## Tasks
- [ ] **Task 3.1**: 提取 API client 和 request helpers
  - Priority: P0
  - Effort: M
  - Acceptance: 网络请求归口，错误处理与通知入口一致
  - Notes: 先统一 fetch 包装层
- [ ] **Task 3.2**: 提取状态管理层和 render scheduler
  - Priority: P0
  - Effort: L
  - Acceptance: 页面状态变更路径清晰，render 入口收敛
  - Notes: 继续兼容本地静态模式与共享模式
- [ ] **Task 3.3**: 按业务域拆分视图与动作
  - Priority: P0
  - Effort: XL
  - Acceptance: room/intake/billing/workflow/system 模块解耦，主入口只做装配
  - Notes: 核心高风险点是结算链和待进驻链

## Phase Notes

- 保留原生前端栈。
- 以渐进模块化为主，避免一次性重写。

## Phase Completion Checklist
- [ ] All tasks above are checked off
- [ ] MASTER.md phase count updated
- [ ] MASTER.md "Current Status" updated to next phase
