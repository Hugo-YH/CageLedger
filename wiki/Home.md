# CageLedger 文档

这里提供 CageLedger 的使用说明、部署手册、开发参考和发行记录。产品介绍、功能演示和系统入口位于<a href="/">项目门户</a>。

## 从任务开始

| 我需要完成的工作                   | 阅读路径                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| 开始录入和处理日常业务             | [快速开始](/guide/getting-started) → [业务流程](/guide/business-flow)                       |
| 接收动物、打印笼卡和安排入驻       | [笼卡管理](/guide/cage-cards) → [笼位与房间管理](/guide/rooms-and-cages)                    |
| 执行房间动物巡检和异常处置         | [动物巡检](/guide/animal-inspection)                                                        |
| 填写数量统计表、生成结算和月度汇总 | [数量统计表](/guide/quantity-sheets) → [饲养费核算](/guide/billing)                         |
| 交回登记、归档与补录报销单         | [结算与报销](/guide/settlement-and-reimbursement)                                           |
| 部署、备份或排查运行问题           | [部署与运行](/operations/deployment) → [故障排查](/operations/troubleshooting)              |
| 维护代码、接口和发布制品           | [本地开发](/development/local-development) → [测试与质量](/development/testing-and-quality) |

## 按角色阅读

### 日常工作人员

[快速开始](/guide/getting-started)介绍登录后的操作顺序。[用户操作手册](/guide/user-manual)按业务模块提供详细步骤。

### 房间管理员

[工作台导航](/guide/navigation)说明授权范围内的入口。[笼位与房间管理](/guide/rooms-and-cages)和[动物巡检](/guide/animal-inspection)覆盖日常维护、占用和复查。

### 系统管理员

[系统配置](/operations/configuration)、[账号与权限](/operations/accounts-and-permissions)、[数据管理与 IACUC 索引](/operations/data-and-iacuc)说明系统管理边界。

### 开发与运维人员

[本地开发](/development/local-development)记录开发环境和端口。[项目结构](/development/project-structure)、[API 与数据模型](/development/api-and-data-model)和[发布与交付](/development/release-and-delivery)覆盖维护路径。

## 文档约定

- `wiki/` 是文档源，生产文档站由 `/docs/` 提供。
- 每页可通过“编辑此页”返回 Gitea 更新源文件；[LLMs.md](/LLMs)与 [llms.txt](/llms.txt) 提供面向 AI 助手的文档索引与约束。
- [更新日志](/releases/)是版本变化的权威记录，并同步系统“关于”页中的发行信息。
- 业务功能、部署方式、环境变量和接口变化同时更新对应的使用、运维和开发页面。
