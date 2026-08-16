# `server_app/legacy.py` 持续拆分：风险评估

## S.U.P.E.R 架构健康度

| 原则         | 状态 | 发现                                              | 优先级 |
| :----------- | :--- | :------------------------------------------------ | :----- |
| S 单一职责   | 🔴   | 单文件覆盖 schema、业务、HTTP 和 runtime          | 高     |
| U 单向依赖   | 🔴   | legacy 横跨全部层，`deps` 字典形成运行时反向装配  | 高     |
| P 显式端口   | 🔴   | 字符串 deps 与动态 `__getattr__` 使公共面隐式扩张 | 高     |
| E 环境无关   | 🟡   | 路径和配置已注入；import 时仍注册数据库初始化器   | 中     |
| R 可替换部件 | 🔴   | handler 和跨域事务移动会影响大量调用点            | 高     |

整体健康度：0/5 完全健康，属于持续重构重点。现有 persistence/domain/repository/web 已提供目标边界，适合渐进迁移。

## 重点热点

1. `CageLedgerHandler`：约 1992 行，路由、鉴权、异常映射与业务执行耦合。
2. State 写入：权限校验、全量写入、审计、commit 和五组缓存失效具有固定顺序。
3. 结算链路：候选快照、PDF 缓存、预热和审计需与事务结果保持一致。
4. Schema migration：旧库幂等、回填顺序和 workflow payload 构造存在跨段依赖。
5. 动态兼容出口：`server.py.__getattr__` 让历史符号成为事实公共 API。

## 风险矩阵

| 风险                     | 影响 | 概率 | 严重度 | 缓解措施                                  |
| :----------------------- | :--- | :--- | :----- | :---------------------------------------- |
| 改变事务、审计、缓存顺序 | 极高 | 高   | 极高   | 以完整 application transaction 为迁移单位 |
| 改变路由优先级或状态码   | 高   | 高   | 极高   | 按域迁移并增加 401/403/404/409 契约测试   |
| 破坏旧库 migration       | 极高 | 中   | 高     | 固定执行顺序，补幂等与 rollback fixture   |
| 丢失历史兼容符号         | 高   | 高   | 高     | 建立公共符号清单并保留显式 re-export      |
| 权限裁剪范围变化         | 高   | 中   | 高     | 覆盖 admin 与 room_admin 跨房间路径       |
| 缓存 key 或失效范围变化  | 中   | 中   | 中     | 保留 actor scope 和 commit 后 effect 顺序 |

## 推荐批次

1. 契约护栏：公共符号、migration 顺序、状态码和事务副作用测试。
2. Schema 与纯转发：先迁无跨段依赖的 migration，再迁 quantity/workflow facade。
3. State aggregate：抽纯规则、projection、audit diff，再迁写入 application service。
4. HTTP：按 admin/IACUC、inspection、reimbursement、quantity、workflow 分组迁移。
5. 高风险事务：结算生成、workflow 推进、报销归档、附件与 PDF/candidate cache。
6. 收尾：legacy 仅保留显式兼容导出、薄 handler 装配和 main，并删除架构热点基线。

## 兼容与验证要求

- 保持 API payload、状态码、权限口径和审计动作名。
- 保持 SQLite schema migration 幂等和旧 payload 兼容。
- 保持 `server.py`、恢复脚本和直接测试导入。
- 每批运行定向 Python tests、架构门禁和 `git diff --check`。
- schema/state/HTTP/billing 批次分别增加 migration fixture、权限路径、API smoke 和缓存审计验证。
