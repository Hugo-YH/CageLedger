# Phase 2：低耦合边界迁移

**状态**：完成

- [x] **T2.1 迁出基础 schema migrations**（P0/M）
  - Notes：迁入 `persistence/legacy_migrations.py`，occupancy backfill 使用显式 callable ports；71 项定向测试、Ruff、架构门禁通过；legacy 由 7350 降至 7152 行。
- [x] **T2.2 迁出 billing workflow migration**（P0/L）
  - Notes：迁入 `persistence/workflow_migration.py`，使用 `BillingWorkflowMigrationPorts`；61 项定向测试通过。
- [x] **T2.3 Runtime 外移**（P1/S）
  - Notes：进程配置与 server lifecycle 迁入 `server_app/runtime.py`；16 项启动/API 契约测试通过。
- [x] **T2.4 迁出 quantity/workflow 薄 facade**（P1/M）
  - Notes：新增 quantity/workflow facade，统一使用 canonical repositories；63 项定向测试通过；legacy 降至 6844 行。

## Notes

- 保持 `legacy.initialize_schema` 和历史 facade 符号 re-export。
- T2.4 发现 workflow line summary 属于 `billing_statements` repository，阶段最终 drift=1，已在任务内修正。
- Phase 2 组合验证：完整 Python suite 179 项通过；受限沙箱首次阻止回环端口和 PDF 浏览器，授权环境复跑通过。

## Phase Completion Checklist

- [x] 全部任务完成
- [x] MASTER.md 阶段计数已更新
- [x] 当前状态已进入 Phase 3
