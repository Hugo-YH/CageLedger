# 前端性能与交互升级：项目基线

日期：2026-08-31。基线：`412003d`，1.1.3 / Build 190。

## 目标与约束

完整审查并改进前端性能、Ant Design 一致性、表格与表单反馈、响应式和克制动效。保持业务规则、权限、API、数据库和打印数据兼容，不迁移框架、不删除功能、不发布。用户已明确要求直接实施；按 P0、P1、P2 推进，不重复索取阶段许可。

## 架构与入口

- React 19 + TypeScript 6 + Vite 8；Ant Design 6.5.2、antd-mobile 5.42.3。
- TanStack Query 5 管理业务数据；UI Context 只保存视图和偏好。TanStack Virtual 服务领域网格。
- `src/main.tsx` 装配 Provider，`App.tsx` 区分公开门户 `/`、工作台 `/app` 和扫码路径。
- `ReactWorkspace.tsx` 按业务页面 lazy 加载；总览图表已延后加载。
- Python 3.13 提供 HTTP / SQLite；本次保持服务端协议及数据模型不变。
- 正式上游为私有 Gitea，无 GitHub remote；使用 `LOCAL_ONLY` 跟踪，不创建远端 Issue/PR。

## 验证基线

- `npm run check:style-ownership`：15 样式文件、9 组件族通过。
- `npm run check:antd-design`：doctor 16 项通过、377 个导入、45 种组件、lint 0 项。
- `npm run benchmark`：临时库 10,000 笼位 / 100,000 记录；总览房间月查询 P95 4.50ms，筛选项 1.59ms，深页 0.21ms；20 并发 intake 7.17ms、settlement 14.38ms。
- 现有 Vitest / Python / Playwright 可用；E2E 默认只跑 Chromium、开发构建，不能证明 Safari 或生产分包兼容。
- 当前本地服务为 Python `:5173`。浏览器检查和自动化业务写入优先使用临时库，避免污染本地业务数据。

## 工程治理

以 `AGENTS.md`、`docs/contracts/` 为唯一工程约束源；未发现现行 `docs/progress/MASTER.md` 或其他已声明的项目记忆文件。无可用原生项目记忆接口，不新建记忆文件。过程存入 progress，稳定契约更新到 contracts，完成后只归档本任务资料，不移动已有独立分析。
