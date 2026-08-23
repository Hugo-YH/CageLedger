# Phase 1: Contract, Rebuild and Validation

**Goal**: 完成系统状态页契约、实现和回归保护。
**Status**: Complete

## Tasks

- [x] **Task 1.1**: 补齐性能指标前端/API 契约
  - Priority: P0
  - Effort: S
  - Test Expectation: TypeScript + Python response shape
  - Memory Impact: 更新 `docs/contracts/api-contracts.md` 与前端状态契约
  - Acceptance: 所有性能字段有显式类型，口径与权限有文档
  - Notes: 已补齐请求、缓存、SQLite 与阈值类型；TypeScript 和 9 项 Python 目标测试通过
- [x] **Task 1.2**: 重建 SystemView 与唯一 CSS 归属
  - Priority: P0
  - Effort: L
  - Test Expectation: antd lint、样式门禁、格式化函数测试
  - Memory Impact: 登记 system-status-page 组件族
  - Acceptance: 页面信息层级、角色边界、响应式和无障碍符合规范
  - Notes: 已完成运行脉搏带、三类诊断卡、客户端工具和本机外观；删除跨文件旧布局与硬编码证书明细；antd lint、样式归属、类型和 3 项格式化测试通过
- [x] **Task 1.3**: 扩展 E2E、文档与全量验证
  - Priority: P1
  - Effort: M
  - Test Expectation: Playwright、Axe、check、smoke、benchmark
  - Memory Impact: 更新测试与 API 文档
  - Acceptance: 四档视口、权限、刷新和无溢出有自动证据
  - Notes: 管理员与房间管理员 E2E、四档视口、Axe、`npm run check`、API 冒烟、10 万记录基准及生产构建均通过

## Phase Notes

- 用户已明确要求“彻底重建”，作为范围和执行确认。
- 不启用自动轮询，避免监控请求污染累计指标。

## Phase Completion Checklist

- [x] All tasks above are checked off
- [x] MASTER.md phase count updated
- [x] Workflow artifacts archived
