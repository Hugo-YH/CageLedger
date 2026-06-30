# CageLedger 拆分风险评估

## S.U.P.E.R 健康度

| 原则                      | 状态 | 主要发现                                               | 优先级 |
| ------------------------- | ---- | ------------------------------------------------------ | ------ |
| Single Purpose            | 🔴   | 后端入口、全局样式和三大业务页面职责聚合               | High   |
| Unidirectional Flow       | 🟡   | 总体无循环，service 依赖字典仍指向入口实现             | High   |
| Ports over Implementation | 🟡   | TypeScript 类型存在，Python 领域边界仍以松散 dict 为主 | High   |
| Environment-Agnostic      | 🟢   | 配置集中于环境变量，部署入口明确                       | Medium |
| Replaceable Parts         | 🔴   | 路由、规则、SQL 和 UI 状态耦合导致替换成本高           | High   |

**整体状态**：1/5 健康，属于需要结构化重构的技术债状态。

## 高风险热点

1. 计费、减免和 PI 合表规则迁移可能造成金额差异；通过特征测试和固定数据逐日对比控制。
2. 幂等迁移拆分可能改变旧库启动顺序；通过旧库副本和 schema/index 快照控制。
3. CSS 规则移动可能改变级联；第一轮按原顺序机械拆分，截图一致后再去重。
4. React 草稿拆分可能引入失焦和额外查询；通过局部 state、ref 和请求次数断言控制。
5. Router 拆分可能改变状态码、Cookie 和错误体；通过 API 契约测试控制。

## 兼容边界

- API 路径、方法、参数、状态码与响应字段保持一致。
- SQLite 表、字段、历史 payload、自动回填与索引语义保持一致。
- QR ID、Animal Record ID、IACUC、权限、审计、转移和流程状态保持一致。
- CSS 类名、DOM 语义、打印模板和导出内容保持一致。
- 所有测试使用临时数据库，`data/` 保持只读。
