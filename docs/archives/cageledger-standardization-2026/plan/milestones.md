# Milestones

| # | Milestone | Target Phase | Criteria | Status |
|:--|:----------|:-------------|:---------|:-------|
| 1 | 契约与边界基线完成 | After Phase 1 | 前端状态契约、核心 API 契约、目录分层蓝图全部落盘 | Completed |
| 2 | 后端单文件拆分完成 | After Phase 2 | `server.py` 核心逻辑完成配置/仓储/服务/HTTP 分层，API shape 保持一致 | Pending |
| 3 | 前端单文件拆分完成 | After Phase 3 | `src/app.js` 完成 API、state、domain、view、print 分层 | Pending |
| 4 | 验证与发布门槛固化 | After Phase 4 | 核心链路回归样本、页面验收、发布契约全部可执行 | Pending |
| 5 | 文档与协作规范统一 | After Phase 5 | Wiki、项目内 skill、进度控制、汇报模板全部同步 | Pending |

## Phase 2 Entry Criteria

- `docs/contracts/frontend-state.md` 可指导前端 state slice 拆分。
- `docs/contracts/api-contracts.md` 可指导 handler/service/repository 返回结构。
- `docs/contracts/module-boundaries.md` 可指导目标目录和回滚边界。
- `npm run check` 通过。

## Completion Rule

每个 milestone 完成后更新 `docs/progress/MASTER.md`、对应 `docs/progress/phase-*.md` 和本文件状态。涉及用户、部署、API、数据结构的变更同步到 `wiki/`。
