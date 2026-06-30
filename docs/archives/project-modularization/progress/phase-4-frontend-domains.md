# Phase 4: 前端领域拆分

**Status**: Complete

- [x] **4.1** 拆 API contracts 与 Query hooks。
- [x] **4.2** 拆 QuantitySheetView。
- [x] **4.3** 拆 CagesView 与 IntakeView。
- [x] **4.4** 拆 Workflow、Rooms 与管理页面。
- [x] **4.5** 拆 release notes 与共享工作区组件。

API contract 已迁到 `src/contracts/` 并保留兼容入口。数量统计、笼位、笼卡、流程和房间页面均按 View、组件与 model 边界拆分，页面 View 控制在 400 行以内。
