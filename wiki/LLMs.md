# CageLedger 文档

> CageLedger 是实验动物中心的笼卡、笼位、动物巡检、数量统计、饲养费结算和单据跟踪系统。本文件面向 AI 助手与自动化工具，提供文档入口、事实来源和维护边界；面向人的使用说明位于[文档首页](/)，同内容的规范导航文件位于 [llms.txt](/llms.txt)。

系统前端采用 React、TypeScript、Vite、TanStack Query 与 Ant Design，后端采用 Python 标准库 HTTP 服务与 SQLite。文档站由 VitePress 生成，每个页面都可通过在原 URL 后追加 `.md` 获取 Markdown 原文，例如 [/guide/getting-started.md](/guide/getting-started.md)。

## 权威来源

- [当前版本与兼容边界](/development/current-baseline.md)：先核对版本、生产入口与实际调用链，再判断现役功能或历史实现
- [当前业务行为](https://git.cellnucle.us/hugo/cageledger)：实际 View、`server_app/domains/`、`server_app/repositories/`
- [API 与数据模型](/development/api-and-data-model.md)：`docs/contracts/api-contracts.md`
- [前端状态与 UI 标准](/development/ui-component-standard.md)：`docs/contracts/frontend-state.md`
- [测试与质量](/development/testing-and-quality.md)：`package.json`、`AGENTS.md`
- [发布与交付](/development/release-and-delivery.md)：`scripts/cloud_release.py`、`scripts/cloud_registry.py`、`docs/contracts/cloud-development.md`；Mac `release_local.sh` 为手动备用
- [更新日志](/releases/index.md)：`wiki/更新日志.md` 与 `src/react/releaseNotes.ts`

## 指南

- [指南导航](/guide/index.md)

- [产品概览](/guide/overview.md)
- [快速开始](/guide/getting-started.md)
- [业务流程](/guide/business-flow.md)
- [工作台导航](/guide/navigation.md)
- [笼卡管理](/guide/cage-cards.md)
- [检疫管理](/guide/quarantine.md)
- [笼位与房间管理](/guide/rooms-and-cages.md)
- [动物巡检](/guide/animal-inspection.md)
- [数量统计表](/guide/quantity-sheets.md)
- [饲养费核算](/guide/billing.md)
- [技术服务费管理](/guide/technical-services.md)
- [实验人员信息](/guide/researchers.md)
- [结算与报销](/guide/settlement-and-reimbursement.md)
- [用户操作手册](/guide/user-manual.md)
- [常见问题](/guide/faq.md)
- [帮助与反馈](/guide/feedback.md)

## 运维

- [运维导航](/operations/index.md)

- [HTTPS 与证书](/operations/https-and-certificate.md)
- [部署与运行](/operations/deployment.md)
- [系统配置](/operations/configuration.md)
- [环境变量](/operations/environment.md)
- [账号与权限](/operations/accounts-and-permissions.md)
- [数据管理与 IACUC 索引](/operations/data-and-iacuc.md)
- [供应商简称映射](/operations/supplier-aliases.md)
- [备份与维护](/operations/backup-and-maintenance.md)
- [故障排查](/operations/troubleshooting.md)

## 开发

- [开发导航](/development/index.md)
- [文档图文与引用](/development/documentation-media.md)

- [本地开发](/development/local-development.md)
- [当前版本与兼容边界](/development/current-baseline.md)
- [项目结构](/development/project-structure.md)
- [前端架构](/development/frontend-architecture.md)
- [后端架构](/development/backend-architecture.md)
- [API 与数据模型](/development/api-and-data-model.md)
- [API 接口清单](/development/api-inventory.md)
- [UI 组件标准](/development/ui-component-standard.md)
- [测试与质量](/development/testing-and-quality.md)
- [开发规范](/development/contributing.md)
- [发布与交付](/development/release-and-delivery.md)

## 更新日志

- [更新日志](/releases/index.md)

## 可选

- [仓库 Wiki 首页](https://git.cellnucle.us/hugo/cageledger/wiki)
- [仓库源码与 Issue](https://git.cellnucle.us/hugo/cageledger)
- [Gitea Releases](https://git.cellnucle.us/hugo/cageledger/releases)

## 约束

- IACUC 是笼卡、占用、数量统计表和结算链路的核心业务键。
- 结算、减免、梯度、IACUC 匹配、权限和审计修改需要同步验证前端、API、SQLite 与导出结果。
- `web-dist/`、`dist/` 和 `data/` 属于构建或运行产物；常规任务不直接编辑。
- 文档中的命令、端口、环境变量和流程以当前代码、脚本与 `docs/contracts/` 为准。
- 旧报销四页签和旧预约补充组件不在当前工作台挂载；测试引用与兼容导出不代表生产可达，前端保留清单由 `check:frontend-lifecycle` 核对。
- `docs/archives/` 和旧计划／演示索引仅用于追溯，不代表当前任务、数据、授权或验证结果。
