# Phase 4: Validation and Release Hardening

**Goal**: 建立核心链路回归、页面验收和发布契约
**Status**: Completed

## Tasks
- [x] **Task 4.1**: 建立核心 API 与迁移回归样本
  - Priority: P0
  - Effort: M
  - Acceptance: 核心 API 和旧库迁移具备固定回归样本
  - Notes: 已新增 `scripts/smoke_api.mjs`，覆盖 auth、bootstrap、intake、placement、quantity、billing workflow、principal identities
- [x] **Task 4.2**: 建立前端关键路径验收脚本与检查清单
  - Priority: P0
  - Effort: M
  - Acceptance: 首页、笼卡、待进驻、结算、流程中心可按清单验收
  - Notes: 已在 Wiki 发布前检查中固定本地服务和关键页面验收
- [x] **Task 4.3**: 固化 release / package / wiki sync contract
  - Priority: P0
  - Effort: M
  - Acceptance: 发布链和文档同步链有固定规则和验证点
  - Notes: 已在 Wiki 发布与 CI/CD 中固定 Gitea Release、Registry、Wiki 三条语义

## Phase Notes

- 这一阶段决定后续改造是否可持续。
- 没有验证门槛的重构会持续回流风险。

## Phase Completion Checklist
- [x] All tasks above are checked off
- [x] MASTER.md phase count updated
- [x] MASTER.md "Current Status" updated to next phase
