# 模块与审查覆盖

| 范围                   | 现有职责与审查重点                                      | 状态   |
| ---------------------- | ------------------------------------------------------- | ------ |
| HTTP、router、请求解析 | 长度、类型、同源、错误边界、头部、超时                  | 已核对并回归 |
| 认证授权               | PBKDF2、session、角色、授权房间、管理员／下载／导出入口 | 已核对并回归 |
| 计费、结算、核销       | 精确金额、事务、来源保护、并发、历史快照                | 已核对并回归 |
| SQLite、SQL、索引      | 连接关闭、锁时长、N+1、投影、查询计划                   | 已核对并回归 |
| 缓存与PDF              | TTL、容量、范围键、空值、失效竞态、后台任务             | 已核对并回归 |
| 外部服务、文件         | 授权头、重定向、读取限额、路径、附件提交清理            | 已核对并回归 |
| 日志与运行             | 安全上下文、慢SQL定位、后台错误、停机                   | 已核对并回归 |
| 依赖、配置、部署       | Python／Node版本、包约束、容器、环境变量                | 已核对并回归 |

领域 Python 文件数（仅代码规模清点，不代表完成安全证明）：

- `administration`：8
- `animal_management`：10
- `billing`：19
- `cages`：3
- `data_quality`：6
- `feedback`：9
- `iacuc`：7
- `infrastructure`：3
- `intake`：17
- `quantity`：5
- `quarantine`：14
- `reimbursement`：8
- `reimbursement_ledger`：14
- `state`：13
- `system_features`：4
- `technical_services`：9
- `workflow`：11

S.U.P.E.R边界沿用已有分层：路由负责协议，service负责事务权限，repository负责读取投影；本轮新增逻辑按现有边界落点，不迁移框架或业务数据。
