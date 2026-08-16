# Phase 4：跨域业务事务

**状态**：完成

- [x] **T4.1 IACUC 同步与 PI identity 归域**（P1/M）
  - Notes：同步、PI identity 与 candidate invalidation 进入 `domains/iacuc/sync.py`；42 项定向测试与 Ruff 通过；package export cycle 通过显式 submodule 入口消除；legacy 降至 4628 行。
- [x] **T4.2 结算生成事务归域**（P0/XL）
  - ♻️ 累计 drift 达到 rescope 阈值。billing generation 按 quantity-sheet 与 occupancy 两个入口迁入同一 application module，共享 statement persistence/effect ports。
  - Notes：三个生成入口进入 `domains/billing/generation.py`，跨域依赖由 `BillingGenerationPorts` 显式声明；60 项定向测试与 Ruff 通过；legacy 降至 4157 行。
- [x] **T4.3 Workflow application transaction**（P0/XL）
  - Notes：payload contracts、persistence adapters、typed `WorkflowServicePorts`、状态推进与附件事务进入 workflow domain；49 项定向测试与 Ruff 通过；legacy 降至 3739 行。
- [x] **T4.4 Reimbursement application transaction**（P0/XL）
  - Notes：repository facade、projector、workbook import、accumulation 与 detail application 已归域；179 项 Python 测试和 architecture enforce 通过；legacy 降至 3231 architecture lines。

## Notes

- 跨域事务保持串行，cache/PDF/audit effects 在 commit 后执行。
