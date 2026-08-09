# Phase 1：恢复架构门禁

**目标**：迁移独立 multipart 解析工具，恢复架构尺寸检查。

## 任务

- [x] **T1.1：提取 multipart 解析并固化契约测试**
  - 优先级：P0
  - 投入：S
  - 验收：`server_app/web/multipart.py` 只使用标准库；现有上传调用继续使用同一函数名；覆盖 multipart 正常与错误契约；`npm run check`、`npm run smoke:api`、`git diff --check` 通过。
  - 备注：保留 `ValueError` 文案和返回字典键，避免前端上传路径回归。

## 阶段备注

- 选择 5034–5070 的解析函数作为最小切片，避开鉴权、路由优先级、SQLite 和领域业务。
- `legacy.py` 架构计数由 7,106 降至 7,070；`npm run check`、`npm run smoke:api` 与 `git diff --check` 通过。

## 阶段完成清单

- [x] 所有任务已完成
- [x] MASTER.md 阶段计数已更新
- [x] MASTER.md 当前状态已更新
