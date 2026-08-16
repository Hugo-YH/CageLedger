# `server_app/legacy.py` 持续拆分：模块清单

评级：🟢 健康，🟡 部分满足，🔴 重点治理。

| 职责簇                  | 当前范围             | 目标 owner                                     | 复杂度 | S.U.P.E.R           |
| :---------------------- | :------------------- | :--------------------------------------------- | :----- | :------------------ |
| Schema 与 migration     | 513–1053             | `server_app/persistence/`                      | 高     | S🟢 U🟢 P🟡 E🟢 R🟢 |
| State 查询与 bootstrap  | 1054–1647            | `domains/state/query.py`                       | 高     | S🟡 U🟡 P🟡 E🟢 R🟡 |
| Entity/state 写入       | 1648–2678            | state/infrastructure/intake/placement services | 极高   | S🔴 U🔴 P🔴 E🟢 R🔴 |
| State 持久化与审计 diff | 2679–3166            | state persistence + audit diff                 | 高     | S🟡 U🟡 P🟡 E🟢 R🟡 |
| IACUC 同步与 PI 身份    | 3167–3504            | `domains/iacuc/`                               | 中     | S🟡 U🟢 P🟡 E🟢 R🟡 |
| 数量统计表 facade       | 3505–3972            | `domains/quantity/`                            | 中     | S🟢 U🟢 P🟢 E🟢 R🟢 |
| 结算单生成              | 3973–4369            | `domains/billing/`                             | 高     | S🟡 U🟡 P🟡 E🟢 R🟡 |
| Workflow facade         | 4370–4608、5117–5326 | `domains/workflow/`                            | 高     | S🟡 U🟢 P🟡 E🟢 R🟡 |
| Reimbursement facade    | 4612–5116            | `domains/reimbursement/`                       | 高     | S🟡 U🟡 P🟡 E🟢 R🟡 |
| HTTP composition        | 5327–7330            | `server_app/web/`                              | 极高   | S🔴 U🔴 P🔴 E🟢 R🔴 |
| Runtime                 | 7331–7349            | `server_app/runtime.py`                        | 低     | S🟢 U🟢 P🟡 E🟢 R🟢 |

## 模块详情

### Schema 与 migration

- 职责：初始化基础表、幂等补列、历史回填和索引修复。
- 公共 API：`initialize_schema`、`migrate_schema`、各 `ensure_*`/`backfill_*`。
- 依赖：`persistence.base_schema`、`persistence.backfills`、administration 初始化、SQLite。
- 迁移策略：先迁 occupancy/intake/IACUC schema，再通过显式 ports 处理依赖 workflow payload builder 的 billing migration。
- S.U.P.E.R：职责连续且环境配置完整；部分函数通过文件后段实现形成隐式端口。

### State 查询、写入与持久化

- 职责：组装 state、权限裁剪、实体 CRUD、事务、审计和缓存失效。
- 公共 API：`read_state`、`write_state`、`assemble_state`、`validate_entity_payload` 等。
- 依赖：repositories、domain services、cache、audit、SQLite。
- 迁移策略：先抽纯 normalization/validation/audit diff，再迁 application command；事务 owner 始终保持唯一。
- S.U.P.E.R：查询、命令和副作用混合；`deps` 字典形成静态检查不可见的反向装配。

### IACUC、数量、结算、流程与报销

- 职责：各业务域的兼容 facade、事务编排和派生数据同步。
- 公共 API：数量表规范化/保存、结算生成、workflow 状态推进、报销导入与累计重算。
- 依赖：对应 domain/repository/service、PDF cache、candidate snapshot 和 audit。
- 迁移策略：优先搬运薄 facade；结算、workflow 推进和报销归档作为完整业务事务迁移。
- S.U.P.E.R：现有 domain 边界可承接；结算链路仍包含跨域副作用顺序约束。

### HTTP composition

- 职责：路由优先级、鉴权、输入解析、异常映射和响应装配。
- 公共 API：`CageLedgerHandler`。
- 依赖：全部业务域、数据库、文件系统和 HTTP 基类。
- 迁移策略：先移除 route matcher 代理，再按域注册 Router；最后保留薄 method dispatch。
- S.U.P.E.R：当前 handler 是最大职责与替换成本热点。

### 兼容面

- `server.py.__getattr__` 会把历史符号暴露给测试、脚本和潜在集成。
- 三组测试直接导入 `legacy.initialize_schema`。
- billing workflow 测试直接导入四个 legacy workflow 函数。
- `scripts/recover_intake_batches_from_audit.py` 直接使用 legacy state 与 intake 写入符号。
- `tests/test_business_rules.py` 经 `server` 使用数量表、workflow 和 entity 规则函数。
