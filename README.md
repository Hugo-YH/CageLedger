# CageLedger

实验动物笼位管理与饲养费核算系统，面向实验动物中心的接收、入驻、占用、结算和报销流程。

## 核心能力

- 笼卡管理：预约消息识别、待接收批次、二维码笼卡、打印和接收确认。
- 笼位管理：饲养间、笼架、笼位、待进驻任务和占用历史。
- 饲养费管理：动态笼位图自动核算、数量统计表录入、PI 合表和减免分配。
- 流程中心：月度结算版本、报销登记、累计欠缴和审计追踪。
- 数据与权限：IACUC 索引、房间授权、SQLite 持久化和操作日志。

## 技术栈

- 前端：React 19、TypeScript、Vite、TanStack Query、TanStack Virtual
- 后端：Python 标准库 HTTP 服务
- 数据库：SQLite，WAL 模式
- 测试：Vitest、Testing Library、Playwright、Python unittest
- 部署：Docker 多阶段构建、离线包、群晖 NAS

## 本地运行

要求 Node.js `>=22.12.0` 和 Python 3.13。

```bash
npm ci
python3 -m pip install -r requirements-dev.txt
npm run dev
```

开发地址：

- 页面：`http://localhost:5173`
- API：`http://127.0.0.1:5174`

默认管理员由环境变量初始化，缺省账号为 `admin / admin123`。

## 常用命令

```bash
npm run build
npm run check
npm run verify:full
npm run test:e2e
npm run smoke:api
npm run benchmark
npm run package:offline
npm run release:local -- --version X.Y.Z --push
```

`npm start` 会构建 React 前端并由 Python 服务在 `5173` 提供生产页面。`npm run package:offline` 生成包含 `web-dist/` 的离线包。

## 文档

- [Wiki 首页](wiki/Home.md)
- [快速开始](wiki/快速开始.md)
- [用户操作手册](wiki/用户操作手册.md)
- [部署与运行](wiki/部署与运行.md)
- [项目结构](wiki/项目结构.md)
- [API 与数据模型](wiki/API与数据模型.md)
- [开发规范](wiki/开发规范.md)
- [发布与 CI-CD](wiki/发布与CI-CD.md)
- [参与开发](CONTRIBUTING.md)
- [安全说明](SECURITY.md)

工程契约位于 `docs/contracts/`，其中包含[代码质量](docs/contracts/code-quality.md)和[测试策略](docs/contracts/testing-strategy.md)。已完成迁移记录位于 `docs/archives/`。

## 项目地址

- Gitea：`https://git.cellnucle.us/hugo/cageledger`
- 容器镜像：`git.cellnucle.us/hugo/cageledger:<tag>`
- 正式文档源：`wiki/`

## 版权

中山大学中山眼科中心实验动物中心，Apache-2.0。联系邮箱：`info@cellnucle.us`。
