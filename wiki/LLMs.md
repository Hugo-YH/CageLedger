# CageLedger LLMs.md

本页为 AI 助手和自动化工具提供 CageLedger 文档入口、事实来源和维护边界。面向人的使用说明位于[文档首页](/)。

## 项目定位

CageLedger 是实验动物中心的笼卡、笼位、动物巡检、数量统计、饲养费结算和报销核销系统。前端采用 React、TypeScript、Vite、TanStack Query 和 Ant Design；后端采用 Python 标准库 HTTP 服务与 SQLite。

## 权威来源

| 主题               | 权威位置                                                                              |
| ------------------ | ------------------------------------------------------------------------------------- |
| 当前业务行为       | `src/react/features/`、`server_app/services/`、`server_app/repositories/`             |
| API 与数据约定     | [API 与数据模型](/development/api-and-data-model)、`docs/contracts/api-contracts.md`  |
| 前端状态与 UI 标准 | `docs/contracts/frontend-state.md`、[UI 组件标准](/development/ui-component-standard) |
| 测试与运行命令     | [测试与质量](/development/testing-and-quality)、`package.json`、`AGENTS.md`           |
| 发布与交付         | [发布与交付](/development/release-and-delivery)、`scripts/release_local.sh`           |
| 版本历史           | [更新日志](/releases/)                                                                |

## 文档导航

- 用户操作：[快速开始](/guide/getting-started)、[业务流程](/guide/business-flow)、[用户操作手册](/guide/user-manual)
- 业务模块：[笼卡管理](/guide/cage-cards)、[笼位与房间管理](/guide/rooms-and-cages)、[动物巡检](/guide/animal-inspection)、[数量统计表](/guide/quantity-sheets)、[结算与报销](/guide/settlement-and-reimbursement)
- 运行维护：[部署与运行](/operations/deployment)、[环境变量](/operations/environment)、[故障排查](/operations/troubleshooting)
- 工程参考：[本地开发](/development/local-development)、[前端架构](/development/frontend-architecture)、[后端架构](/development/backend-architecture)

## 约束

- IACUC 是笼卡、占用、数量统计表和结算链路的核心业务键。
- 结算、减免、梯度、IACUC 匹配、权限和审计修改需要同步验证前端、API、SQLite 与导出结果。
- `web-dist/`、`dist/` 和 `data/` 属于构建或运行产物；常规任务不直接编辑。
- 文档中的命令、端口、环境变量和流程以当前代码、脚本与 `docs/contracts/` 为准。
