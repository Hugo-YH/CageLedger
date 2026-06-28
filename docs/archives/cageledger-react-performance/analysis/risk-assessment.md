# React/Vite 性能升级风险评估

## S.U.P.E.R 健康度

| 原则 | 状态 | 主要问题 | 优先级 |
|:-----|:-----|:---------|:-------|
| Single Purpose | 绿 | 业务视图、Query API、领域函数和服务仓储按职责拆分 | Low |
| Unidirectional Flow | 绿 | React view -> Query/API -> service -> repository -> SQLite | Low |
| Ports over Implementation | 绿 | TypeScript contracts 和现有 JSON API 固定模块边界 | Low |
| Environment-Agnostic | 绿 | 开发使用 Vite 代理，生产与离线统一使用 Python + web-dist | Low |
| Replaceable Parts | 绿 | 页面、API hooks、领域函数和仓储可按目录独立替换 | Low |

## 主要风险

| 风险 | 严重度 | 控制措施 |
|:-----|:-------|:---------|
| 一次性入口切换产生业务回归 | Critical | 旧版冻结作参照，按业务链建立 Playwright 回归后再切入口 |
| React 受控录入导致数量统计表卡顿 | High | 按行隔离状态、稳定 key、局部订阅和性能断言 |
| 视觉等价范围过大 | High | 复用现有 CSS 变量、类名语义和多分辨率截图 |
| SQLite 新列与旧库不一致 | High | 增量迁移、payload 回填、旧版本可忽略新增列 |
| Vite 构建破坏离线和容器发布 | High | `web-dist` 统一产物，多阶段 Docker，离线包构建后打包 |
| 基准数据污染运行库 | High | 所有性能数据仅创建在系统临时目录 |

## 固定兼容要求

- IACUC、项目来源、减免、动物/笼日和结算状态规则保持不变。
- 房间管理员权限过滤继续在后端执行。
- API 路径、Cookie Session、深链接、打印和导出保持兼容。
- 数据库迁移可由 `v0.5.25` 代码安全忽略，版本制品支持回滚。
