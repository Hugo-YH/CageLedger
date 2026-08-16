# `server_app/legacy.py` 持续拆分：任务拆解

## 概览

- 阶段：6
- 任务：18
- 总工作量：XL
- 策略：契约护栏 → 低耦合迁移 → state 分层 → 核心事务归域 → HTTP 薄化 → 兼容收口

## 全局 S.U.P.E.R 约束

- S：每个新模块只有一个可陈述职责。
- U：web → application/domain → repository/persistence，禁止反向依赖和循环导入。
- P：跨模块输入输出采用显式、可序列化的数据结构；副作用通过具名端口表达。
- E：路径、端口和外部服务继续由 config/环境变量注入。
- R：迁移期间保留兼容 re-export；最终替换单一实现只影响其 owner 目录。

## Phase 1：契约护栏

目标：冻结兼容公共面与关键行为。

| ID   | 任务                   | 优先级 | 工作量 | 依赖 | Lane | S.U.P.E.R | 验收标准                                                                                    |
| :--- | :--------------------- | :----- | :----- | :--- | :--- | :-------- | :------------------------------------------------------------------------------------------ |
| T1.1 | 公共符号清单与兼容测试 | P0     | S      | —    | A    | P,R       | 覆盖 `initialize_schema`、workflow 四函数、恢复脚本和 `server` 转发符号；allowlist 测试通过 |
| T1.2 | 行为基线测试           | P0     | M      | T1.1 | A    | U,P,R     | 固定 migration 幂等、HTTP 关键状态码、权限裁剪、审计及 commit 后副作用顺序                  |

Lane A 串行执行，merge risk 低；主要文件为兼容契约测试和 migration/API fixtures。

## Phase 2：低耦合边界迁移

目标：让 legacy 脱离硬上限并建立明确 owner。

| ID   | 任务                             | 优先级 | 工作量 | 依赖 | Lane | S.U.P.E.R | 验收标准                                                          |
| :--- | :------------------------------- | :----- | :----- | :--- | :--- | :-------- | :---------------------------------------------------------------- |
| T2.1 | 迁出基础 schema migrations       | P0     | M      | T1.2 | B    | S,U,R     | occupancy/intake/IACUC migration 外移；旧库、重复初始化和回填一致 |
| T2.2 | 迁出 billing workflow migration  | P0     | L      | T2.1 | B    | U,P,R     | typed ports 消除 persistence→legacy；workflow 回填 payload 一致   |
| T2.3 | Runtime 外移                     | P1     | S      | T2.1 | D    | S,E,R     | 启动、配置输出、PDF 预热和关闭行为一致                            |
| T2.4 | 迁出 quantity/workflow 薄 facade | P1     | M      | T1.1 | C    | S,U,R     | repository 成为 SQL owner；历史符号与 quantity/workflow 测试稳定  |

Lanes B、C、D 可并行；B 与 C 均修改 legacy imports，merge risk 中；D merge risk 低。

## Phase 3：State aggregate 分层

目标：分离纯规则、查询持久化与 application commands。

| ID   | 任务                                | 优先级 | 工作量 | 依赖      | Lane | S.U.P.E.R | 验收标准                                                                |
| :--- | :---------------------------------- | :----- | :----- | :-------- | :--- | :-------- | :---------------------------------------------------------------------- |
| T3.1 | 抽 projection/validation/audit diff | P0     | L      | T1.2      | B    | S,U,P,R   | 纯函数脱离 DB/cache；state、权限和审计 golden tests 一致                |
| T3.2 | 迁出 state query/persistence        | P0     | L      | T3.1,T2.1 | B    | S,U,P     | repository 独占 SQL；bootstrap scope、actor cache key 和 snapshots 一致 |
| T3.3 | 迁出 entity application commands    | P0     | XL     | T3.2      | B    | S,U,P,R   | 单一事务 owner；移除字符串 deps；权限、并发、入住转笼与恢复脚本通过     |

Lane B 串行执行，merge risk 高；每个任务独立提交并运行完整 Python tests。

## Phase 4：跨域业务事务

目标：让 IACUC、billing、workflow 和 reimbursement 各自拥有完整事务。

| ID   | 任务                                  | 优先级 | 工作量 | 依赖           | Lane | S.U.P.E.R | 验收标准                                                      |
| :--- | :------------------------------------ | :----- | :----- | :------------- | :--- | :-------- | :------------------------------------------------------------ |
| T4.1 | IACUC 同步与 PI identity 归域         | P1     | M      | T3.2           | C    | S,U,P     | 字段传播、来源映射、候选快照失效与审计一致                    |
| T4.2 | 结算生成事务归域                      | P0     | XL     | T2.4,T3.2,T1.2 | C    | S,U,P,R   | 两种数据入口、计费 golden tests、commit 后 cache/PDF 顺序一致 |
| T4.3 | Workflow application transaction      | P0     | XL     | T4.2           | C    | S,U,P,R   | 状态机、版本、事件、附件权限、冲突和审计一致                  |
| T4.4 | Reimbursement application transaction | P0     | XL     | T4.3           | C    | S,U,P,R   | 导入、累计、分摊及 workflow 归档联动保持兼容                  |

Lane C 串行执行，merge risk 高；跨域事务禁止拆分 commit、audit 和 cache effects。

## Phase 5：HTTP composition

目标：将 handler 收敛为协议适配与 method dispatch。

| ID   | 任务                             | 优先级 | 工作量 | 依赖                     | Lane | S.U.P.E.R | 验收标准                                                |
| :--- | :------------------------------- | :----- | :----- | :----------------------- | :--- | :-------- | :------------------------------------------------------ |
| T5.1 | Router 注册器与 matcher 代理清理 | P0     | M      | T1.2                     | D    | S,U,P     | 路由表快照一致；重复/歧义路由可检测；静态 fallback 稳定 |
| T5.2 | 按域迁移 read handlers           | P1     | L      | T5.1,T3.2,T4.1           | D    | S,U,P,R   | 分页、过滤、actor scope、下载 headers 和状态码一致      |
| T5.3 | 按域迁移 write handlers          | P0     | XL     | T5.2,T3.3,T4.2,T4.3,T4.4 | D    | S,U,P,R   | 401/403/404/409、multipart、审计与副作用测试通过        |

Lane D 串行执行，merge risk 高；域级 handler 按独立批次落地和验证。

## Phase 6：兼容收口

目标：完成薄兼容层并移除架构热点基线。

| ID   | 任务                        | 优先级 | 工作量 | 依赖                     | Lane | S.U.P.E.R | 验收标准                                                                                     |
| :--- | :-------------------------- | :----- | :----- | :----------------------- | :--- | :-------- | :------------------------------------------------------------------------------------------- |
| T6.1 | 显式 re-export 与动态面收缩 | P1     | M      | T2.2,T2.3,T3.3,T4.4,T5.3 | A    | P,R,E     | legacy 无 SQL/业务/域 handler；兼容符号测试和恢复脚本通过                                    |
| T6.2 | 删除热点基线并全量验证      | P0     | M      | T6.1                     | A    | S,U,P,E,R | legacy ≤250 行；删除 7350 baseline；`check`、`smoke:api`、`verify:full`、`diff --check` 通过 |

Lane A 串行执行，merge risk 中；同步更新 contracts、wiki 和最终归档。
