# Phase 3：State aggregate 分层

**状态**：完成

- [x] **T3.1 抽 projection/validation/audit diff**（P0/L）
  - ⚠️ 前一阶段出现 1 个未计划 repository 分属关系，本任务先核对所有依赖 owner。
  - Notes：新增 `domains/state/entity_rules.py` 与 `audit_diff.py`；49 项定向测试、Ruff、API 契约和架构门禁通过；legacy 降至 6547 行。
- [x] **T3.2 迁出 state query/persistence**（P0/L）
  - ⚠️ T3.1 发现动态 `server.validate_entity_payload` 访问，后续迁移继续核对属性式兼容调用。
  - Notes：查询、actor scope、occupancy snapshot 与 normalized state SQL 已进入 state domain/repository；45 项定向测试、Ruff、编译和架构门禁通过；legacy 降至 5695 architecture lines。
- [x] **T3.3 迁出 entity application commands**（P0/XL）
  - ♻️ 累计 drift 达到重规划阈值。按 infrastructure → intake → placement → occupancy 四个事务切片串行迁移，每片保持 permission → write → audit → commit → cache 顺序。
  - Notes：新增 infrastructure/intake/placement/occupancy command modules 与共享 entity mutations；179 项 Python 测试、Ruff、编译、架构门禁通过；legacy 降至 4959 architecture lines。

## Notes

- 事务 owner 保持唯一，权限、审计、commit 和缓存顺序保持稳定。
