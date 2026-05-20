# Phase 3: Frontend Decomposition

**Goal**: 把 `src/app.js` 拆成 API、state、view、domain helper 四层
**Status**: Completed

## Tasks
- [x] **Task 3.1**: 提取 API client 和 request helpers
  - Priority: P0
  - Effort: M
  - Acceptance: 网络请求归口，错误处理与通知入口一致
  - Notes: 已新增 `src/api/`，endpoint、URL builder 和 request helper 已形成模块边界
- [x] **Task 3.2**: 提取状态管理层和 render scheduler
  - Priority: P0
  - Effort: L
  - Acceptance: 页面状态变更路径清晰，render 入口收敛
  - Notes: 已新增 `src/state/`，本地状态常量与存储 helper 已形成模块边界
- [x] **Task 3.3**: 按业务域拆分视图与动作
  - Priority: P0
  - Effort: XL
  - Acceptance: room/intake/billing/workflow/system 模块解耦，主入口只做装配
  - Notes: 已新增 `src/views/`、`src/domain/`、`src/print/`，主入口保留装配与事件委托

## Phase Notes

- 保留原生前端栈。
- 以渐进模块化为主，避免一次性重写。

## Phase Completion Checklist
- [x] All tasks above are checked off
- [x] MASTER.md phase count updated
- [x] MASTER.md "Current Status" updated to next phase
