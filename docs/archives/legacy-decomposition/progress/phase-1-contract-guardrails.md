# Phase 1：契约护栏

**状态**：完成

- [x] **T1.1 公共符号清单与兼容测试**（P0/S）
  - 验收：历史直接导入、恢复脚本依赖和 `server` 转发符号具备显式 allowlist 测试。
  - Notes：新增 `server_app/compatibility.py` 与 3 项静态导入/运行时解析测试；定向 unittest、Ruff、架构门禁和 diff 检查通过。
- [x] **T1.2 行为基线测试**（P0/M，依赖 T1.1）
  - 验收：migration 幂等、关键状态码、权限、审计和 commit 后副作用具有稳定断言。
  - Notes：新增完整 schema snapshot 重入测试；并发、索引、API 与系统环境共 19 项定向测试通过。

## Phase Completion Checklist

- [x] 全部任务完成
- [x] MASTER.md 阶段计数已更新
- [x] 当前状态已进入 Phase 2

## Notes

- 兼容出口在拆分期间保持，Phase 6 再收缩动态解析面。
