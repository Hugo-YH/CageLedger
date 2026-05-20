# Phase 2: Backend Decomposition

**Goal**: 把 `server.py` 拆成配置层、仓储层、服务层和 HTTP 路由层
**Status**: Not Started

## Tasks
- [ ] **Task 2.1**: 提取配置、连接、缓存与通用响应层
  - Priority: P0
  - Effort: M
  - Acceptance: backend 基础设施层独立，现有行为一致
  - Notes: 优先处理低风险公共能力
- [ ] **Task 2.2**: 提取仓储层
  - Priority: P0
  - Effort: L
  - Acceptance: 核心 SQL 访问收敛到 repository helpers
  - Notes: 从 rooms/racks/slots/occupancies/intake/billing/workflows 六组开始
- [ ] **Task 2.3**: 提取领域服务层
  - Priority: P0
  - Effort: L
  - Acceptance: 结算、流程、待进驻等复杂链路脱离 route 层
  - Notes: 每迁移一组都要保留回归样本

## Phase Notes

- 保留 Python 标准库后端方案。
- 先分层，再决定文件进一步拆分粒度。

## Phase Completion Checklist
- [ ] All tasks above are checked off
- [ ] MASTER.md phase count updated
- [ ] MASTER.md "Current Status" updated to next phase
