# CageLedger

实验动物笼位管理与饲养费核算系统，面向实验动物中心的接收、检疫、入驻、巡检、结算和报销流程。以 IACUC 连接项目、负责人和费用，以 Animal Record ID 保留笼卡实例的持久身份。

[版本与安装包](https://git.cellnucle.us/hugo/cageledger/releases) · [更新记录](wiki/更新日志.md) · [使用手册](wiki/用户操作手册.md) · [部署指南](wiki/部署与运行.md)

## 核心能力

| 模块       | 主要能力                                                                         |
| ---------- | -------------------------------------------------------------------------------- |
| 笼卡管理   | 预约消息本地／AI 识别、待接收批次、笼卡打印、接收确认和二维码查询                |
| 检疫管理   | 检疫批次、寄生虫／ELISA／PCR 检测、样本与附件管理、PDF 报告和整批完成确认        |
| 笼位管理   | 饲养间、笼架、笼位、待进驻任务、动态笼位图和占用历史                             |
| 动物巡检   | 巡检目录、参考图、巡检记录、异常登记、处置和复查                                 |
| 饲养费管理 | 月度数量统计表、逐日计费、转入转出镜像记录、自定义收费、项目负责人合表和减免分配 |
| 结算与报销 | 结算单 PDF／Excel、流程发起与单据跟踪、报销登记、核销分摊和月度汇总              |
| 帮助与反馈 | 站内反馈、截图与 Markdown、Gitea 处理进展同步、管理员导入历史工单                |
| 系统管理   | IACUC 索引、账号和房间授权、备份恢复、操作日志与运行状态                         |

当前正式结算入口是数量统计表。动态笼位图核算仍处于调试阶段，暂未作为正式结算入口；结算流程和报销台账分别记录单据进展与缴费情况。

预约消息 AI 识别需配置 DeepSeek；未配置时可使用本地识别。反馈先在系统留档，配置 Gitea 凭据后同步工单；处理状态由 Gitea 维护，历史工单由管理员选择导入。

## Docker 运行

正式镜像支持 `linux/amd64` 和 `linux/arm64`，目标机器无需安装 Node.js 或 Python。

克隆仓库后，在项目目录复制 `.env.example` 为 `.env`，设置初始管理员用户名和密码，再启动：

```bash
cp .env.example .env
```

```bash
docker run -d --name cageledger --restart unless-stopped \
  --env-file .env \
  -p 5173:5173 \
  -v cageledger-data:/app/data \
  ddns.cellnucle.us:3333/hugo/cageledger:latest
```

`cageledger-data` 保存数据库与附件。正式部署可将 `latest` 替换为[发布页](https://git.cellnucle.us/hugo/cageledger/releases)中的版本号，例如 `1.6.0`。Compose、群晖 NAS、离线镜像与升级步骤见[部署与运行](wiki/部署与运行.md)；备份范围见[备份与维护](wiki/备份与维护.md)。

## 技术栈

- 前端：React 19、TypeScript、Vite、Ant Design、antd-mobile、TanStack Query、TanStack Virtual
- 后端：Python 3.13 标准库 HTTP 服务，领域 service／repository 分层
- 数据库：SQLite，WAL 模式
- 打印与导出：Playwright／Chromium、LibreOffice Writer、Excel
- 文档：VitePress，随应用构建并提供 `/docs/` 入口
- 测试：Vitest、Testing Library、Playwright、Python unittest
- 部署：Docker 多阶段构建、离线包、群晖 NAS

## 本地开发

要求 Node.js `>=22.12.0 <23` 和 Python 3.13；版本文件分别为 `.nvmrc`、`.python-version`。克隆仓库并进入项目目录后执行：

```bash
npm ci
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm run dev
```

默认开发地址：

- 项目门户：`http://localhost:5173/`
- 业务工作台：`http://localhost:5173/app`
- 文档与更新记录：`http://localhost:5173/docs/`、`http://localhost:5173/docs/releases/`
- API：`http://127.0.0.1:5174`

开发服务同时启动 Vite、Python API 和 VitePress。端口可通过 `CAGELEDGER_DEV_PORT`、`CAGELEDGER_DEV_API_PORT`、`CAGELEDGER_DOCS_PORT` 调整。

初始管理员由 `CAGELEDGER_ADMIN_USERNAME`、`CAGELEDGER_ADMIN_PASSWORD` 配置；未配置时为 `admin / admin123`。这些变量用于首次初始化，已有账号不会因修改变量而重置。

本地生成 PDF 需安装 Chromium、LibreOffice Writer 和中文字体，或配置对应可执行文件路径；Docker 镜像已包含运行组件。环境设置、浏览器测试和开发规范见[参与开发](CONTRIBUTING.md)。

## 常用命令

| 命令                            | 用途                                       |
| ------------------------------- | ------------------------------------------ |
| `npm run dev`                   | 开发页面、API 和文档站                     |
| `npm start`                     | 构建后启动本地生产服务                     |
| `npm run build`                 | 构建业务页面和 VitePress 文档              |
| `npm run check`                 | 格式、lint、类型、前后端测试与项目契约检查 |
| `npm run test:e2e`              | Chromium 业务回归，默认使用隔离数据库      |
| `npm run test:e2e:compat`       | Firefox／WebKit 桌面兼容性检查             |
| `npm run verify:full`           | 统一检查、生产构建和三浏览器回归           |
| `npm run package:offline`       | 生成包含 `web-dist/` 的离线源码包          |
| `npm run package:offline:image` | 导出双架构离线镜像与校验文件               |

本地生产服务在 `5173` 同时提供页面、文档和 `/api`。离线源码包在目标机器运行时无需 Node.js，仍需 Python 3.13 和运行依赖。

项目 Python 命令默认使用 `.venv`；可通过 `CAGELEDGER_PYTHON_BIN` 指定其他 Python 3.13 可执行文件。验证范围见[测试策略](docs/contracts/testing-strategy.md)。正式发布从 `main` 执行 `npm run release:local -- --version X.Y.Z --push`，具体流程见[发布与 CI-CD](wiki/发布与CI-CD.md)。

## 文档

文档源位于 `wiki/`，部署后通过 `/docs/` 访问；Gitea Wiki 保留文档迁移入口。以下链接可直接阅读仓库内的源文件：

- [文档首页](wiki/Home.md)
- [产品概览](wiki/产品概览.md)
- [快速开始](wiki/快速开始.md)
- [用户操作手册](wiki/用户操作手册.md)
- [部署与运行](wiki/部署与运行.md)
- [系统配置](wiki/系统配置.md)
- [帮助与反馈](wiki/帮助与反馈.md)
- [备份与维护](wiki/备份与维护.md)
- [项目结构](wiki/项目结构.md)
- [API 与数据模型](wiki/API与数据模型.md)
- [开发规范](wiki/开发规范.md)
- [发布与 CI-CD](wiki/发布与CI-CD.md)
- [参与开发](CONTRIBUTING.md)
- [安全说明](SECURITY.md)

工程契约位于 `docs/contracts/`，其中包含[代码质量](docs/contracts/code-quality.md)、[UI 组件标准](docs/contracts/ui-component-standard.md)和[测试策略](docs/contracts/testing-strategy.md)。已完成迁移记录位于 `docs/archives/`。

## 项目地址

- [Gitea 仓库](https://git.cellnucle.us/hugo/cageledger)
- [版本与安装包](https://git.cellnucle.us/hugo/cageledger/releases)
- 正式容器镜像：`ddns.cellnucle.us:3333/hugo/cageledger:<版本号>`，另提供 `latest`、`<版本号>-amd64` 和 `<版本号>-arm64`

## 版权

中山大学中山眼科中心实验动物中心，Apache-2.0。联系邮箱：`info@cellnucle.us`。
