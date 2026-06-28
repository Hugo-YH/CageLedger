# Phase 2: Backend Decomposition

**Goal**: 把 `server.py` 拆成配置层、仓储层、服务层和 HTTP 路由层
**Status**: Completed

## Tasks
- [x] **Task 2.1**: 提取配置、连接、缓存与通用响应层
  - Priority: P0
  - Effort: M
  - Acceptance: backend 基础设施层独立，现有行为一致
  - Notes: 已新增 `server_app/config.py`、`server_app/db.py`、`server_app/cache.py`、`server_app/http.py`，`server.py` 保持兼容入口
- [x] **Task 2.2**: 提取仓储层
  - Priority: P0
  - Effort: L
  - Acceptance: 核心 SQL 访问收敛到 repository helpers
  - Notes: 当前 active task。已完成通用 payload/settings 分页仓储、room/rack/slot 写入仓储、users/audit/iacuc/entities 仓储、billing/state 只读仓储，以及 quantity sheets、billing workflow、principal identity 的写入和聚合仓储；下一步继续清理少量零散 SQL，并准备切入服务层
- [x] **Task 2.3**: 提取领域服务层
  - Priority: P0
  - Effort: L
  - Acceptance: 结算、流程、待进驻等复杂链路脱离 route 层
  - Notes: 主链已覆盖。`server_app/services/quantity.py` 承接 quantity transfer sync，`server_app/services/billing.py` 承接 billing workflow 生成与状态推进，`server_app/services/intake.py` 承接 intake receipt，`server_app/services/placement.py` 承接 placement reserve / move-in / reassign；当前已补 service dependency helper，下一步继续迁移 `generate_billing_statement*` 入口和少量散落 helper

## Phase Notes

- 保留 Python 标准库后端方案。
- 先分层，再决定文件进一步拆分粒度。
- 后端写入接口返回结构以 `docs/contracts/api-contracts.md` 为准。

## Phase Completion Checklist
- [x] All tasks above are checked off
- [x] MASTER.md phase count updated
- [x] MASTER.md "Current Status" updated to next phase
