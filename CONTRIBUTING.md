# 参与 CageLedger 开发

本文说明开发环境、代码边界、质量检查和提交要求。日常开发、验收和定向测试以 [Codex 云端开发](docs/contracts/cloud-development.md) 为入口；明确交付任务的软件包也由云端构建，代码及 ARM64 产物推送到 Gitea。[Mac mini Runner](docs/contracts/macos-gitea-runner.md) 仅作可选手动备用。业务口径以 `AGENTS.md` 和 `docs/contracts/` 为准。

## 环境

- Node.js 22，建议使用 `.nvmrc`：`nvm use`。
- 当前锁文件使用 npm 11.21.1 验证；保留本机其他项目的 npm 时，可用下方固定版本入口。
- Python 3.13，版本文件为 `.python-version`。
- ShellCheck，macOS 使用 `brew install shellcheck` 安装。
- Python 依赖分为运行依赖 `requirements.txt` 和开发依赖 `requirements-dev.txt`。

```bash
npx --yes --package npm@11.21.1 npm ci
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm run dev
```

此次 beta 在 Node 22.23.3 / npm 11.21.1 下完成默认策略的干净安装；npm 10.9.9 的默认 `ci` 对既有 React peer 图仍报锁文件缺项。`antd-mobile` 间接使用的 `@react-spring/web` 声明尚未覆盖 React 19，严格 peer 检查仍失败；实际交互回归通过不能替代上游兼容声明。不要用自动降级移动组件或新增 `--force` 绕过。现有 Dockerfile 使用 `--legacy-peer-deps`，与本地默认安装策略的差异仍须在单独的依赖兼容任务中收敛。

开发页面为 `http://localhost:5173`，Vite 将 `/api` 代理到 `http://127.0.0.1:5174`。

Vite开发服务拒绝通过静态文件或raw模块读取本工程的`data/`目录；业务数据通过`/api`访问。`server.fs.deny`同时保留当前Vite默认敏感文件保护，规则使用本工程绝对路径，避免匹配名为Data的父卷。升级Vite时运行`node scripts/run_python.mjs -m unittest discover -s tests -p test_vite_data_boundary.py`，核对新增默认规则和合成HTTP边界；该回归不请求真实数据库或附件。

项目文档和更新记录分别位于 `/docs/`、`/docs/releases/`，开发服务同时启动 VitePress 并代理其页面和热更新连接。使用 `CAGELEDGER_DEV_PORT`、`CAGELEDGER_DEV_API_PORT`、`CAGELEDGER_DOCS_PORT` 启动不同端口的实例时，代理默认跟随实际 API／文档端口；文档预构建缓存按端口隔离，避免测试或另一实例导致文档空白。`CAGELEDGER_API_ORIGIN`、`CAGELEDGER_DOCS_ORIGIN` 可显式覆盖代理目标。

通过 Codex 或 SSH 转发开发端口时，浏览器地址中的端口可能不同于 5173。若写入提示“请求来源不受信任”，
在本地 `.env` 的 `CAGELEDGER_CORS_ALLOWED_ORIGINS` 中添加浏览器实际显示的 origin（例如
`http://localhost:56519`，不含 `/app`），多个地址用逗号分隔，然后重启 `npm run dev`。
转发地址变化时更新该配置；只登记实际使用的入口，不使用通配符，也不关闭服务端来源校验。

检疫报告直接下载 PDF，服务端使用 LibreOffice Writer 转换保留的实验室模板。运行环境需有
`soffice` 或 `libreoffice`；也可在本地 `.env` 配置 `CAGELEDGER_LIBREOFFICE_BIN` 为可执行文件的绝对路径。
容器已安装 Writer 和 Noto CJK 字体；本机应安装宋体、思源宋体或 Noto Serif CJK 字体。
转换使用独立临时配置目录，超时或转换失败时不会出具报告。已有 Word 报告下载时转换为 PDF，原存档不覆盖。

接收管理的合格证PDF上传使用Poppler的`pdfinfo`和`pdftoppm`校验原件、生成首页PNG；本机开发安装`brew install poppler`，生产镜像已包含`poppler-utils`。可用`CAGELEDGER_PDFINFO_BIN`、`CAGELEDGER_PDFTOPPM_BIN`指定可执行文件路径。原件保留全部页面，AI只接收首页图片；缺少组件时返回局部503提示，不阻塞接收列表或影响已有数据。

## 分支和提交

- 开发只使用 `main`、`beta`、`rc`。当前版本修复及小功能在同步后的默认分支 `main` 上直接开发、提交和推送；下一大版本开发使用 `beta`，预发布整合使用 `rc`，不另建临时开发分支。完整约定见 [分支策略](docs/contracts/branching.md)。
- 一个提交处理一个可说明的改动组。机械格式化、行为修改和文档更新尽量分开。
- 提交前查看 `git status` 和 `git diff`，保留工作区中已有的其他改动。
- 运行库、构建产物、浏览器报告和本地 Secret 不进入 Git。

## 代码边界

| 改动                | 入口                           |
| ------------------- | ------------------------------ |
| React 页面和交互    | `src/react/features/`          |
| 通用组件            | `src/react/components/`        |
| typed API 和缓存    | `src/react/api/`               |
| API 数据契约        | `src/contracts/`               |
| 纯业务函数          | `src/domain/`                  |
| 打印、二维码和 PDF  | `src/react/print/`             |
| HTTP 与应用装配     | `server.py`、`server_app/web/` |
| 领域业务            | `server_app/domains/`          |
| SQLite 访问         | `server_app/repositories/`     |
| 迁移期 service 兼容 | `server_app/services/`         |

跨边界数据使用显式 TypeScript 类型或可序列化 JSON 契约。服务端业务数据由 TanStack Query 管理，本地 reducer 只保存 UI 偏好。

通知、操作结果与长任务反馈按[通知与操作反馈契约](docs/contracts/ui-feedback.md)选择 Notification、Message 或 Alert；现有业务反馈的盘点与待迁移点由该契约提供入口。

## 格式和 lint

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
```

- Prettier 处理 TS、TSX、CSS、JSON、YAML 和活动 Markdown。
- ESLint 检查 TypeScript、React Hooks、React Refresh 和 JSX 可访问性。
- Stylelint 检查 CSS 标准语法、未知值和重复声明。
- Markdownlint 检查活动文档。
- Ruff 处理 Python 格式、import 和 lint。
- `bash -n` 和 ShellCheck 进入 Mac mini 本地基础质量检查。

`docs/archives/`、`src/vendor/`、`web-dist/`、`dist/` 和 `data/` 保持在批量格式化范围外。

## 验证

按 [测试策略](docs/contracts/testing-strategy.md) 选择与改动相关的检查；该文件统一维护验证矩阵、UI 分级验收、结算双渲染和性能历史要求。相关小改集中完成后统一验证；纯文档修改只检查相关文档。日常提交和推送不要求完整检查，简单修改不执行全量测试、生产构建或打包；高风险改动保留受影响业务的回归。交付按风险验证，完整回归仅在明确要求或共享基础变化需要时执行，未受后续改动影响的成功结果可复用。

代理指令与 Skills 的维护约定见 [agent-instructions.md](docs/contracts/agent-instructions.md)。

受管基础质量检查（不含业务全量测试或构建）：

```bash
npm run verify:quality
```

完整验证的受管串行入口（明确选择完整范围时使用）：

```bash
npm run verify:full
```

Mac mini（M4 16GB）固定单组浏览器和单 worker；`check`、`verify:full` 与发布共用跨检出的宿主机锁和内存压力保护。日常使用 `test:target`、`test:related`、`test:python:target` 指定目标，纯文字/间距不跑无关业务测试。具体命令、影响分析与用例治理见 [测试策略](docs/contracts/testing-strategy.md)。

`npm run dev`、`npm run check`、`npm run test:e2e` 和 Python 质量工具统一解析项目 `.venv`。`CAGELEDGER_PYTHON_BIN` 可覆盖为其他 Python 3.13 可执行文件。

共享 Python 启动入口会先验证3.13，再执行测试、核查或开发任务；显式覆盖不能绕过版本要求。同一Node进程对同一路径只探测一次，避免开发启动重复探测。

Codex 云端负责日常开发、验收、按影响范围的测试和交付任务的软件包构建；代码及产物推送到 Gitea，由 Gitea 托管代码和软件包。Mac mini Runner 仅作可选手动备用。备用 Runner 部署见 [Mac mini Gitea Runner](docs/contracts/macos-gitea-runner.md)，工作流仅手动触发。提交、推送、上传、发布与部署按各自授权执行；构建入口和现有 Mac mini 发布兼容边界见 [云端开发](docs/contracts/cloud-development.md)。

## 可访问性

- 图标按钮提供可访问名称。
- label 与输入控件建立关联，错误信息使用 `aria-invalid` 和描述关系。
- 弹窗进入时移动焦点，支持 Tab 约束和 Escape 关闭，关闭后恢复触发按钮焦点。
- 展开控件提供 `aria-expanded` 和 `aria-controls`。
- toast、加载和错误状态使用合适的 live region。

## 发布

明确交付任务使用 `npm run package:managed` 受管打包，串行生成离线源码包和 ARM64 离线镜像；普通开发修改不自动打包。测试、构建与上传必须对应同一源码状态和来源 revision，旧版本产物不覆盖，NAS 不自动部署。普通开发产物可保存到 Gitea 私有仓库的开发构建草稿附件，不等同于正式 Release。单项入口为 `package:offline`、`package:container`。以下为保留的 Mac mini 受管发布流程；其平台专用转换器校验仍然有效，不作为云端普通构建的前置条件。

1. 在 `wiki/更新日志.md` 增加版本、日期和面向使用者的说明，再运行 `npm run release:notes:sync`。
2. 正式版本在 `main` 上发布，预发布经 `beta → rc → main` 推进。
3. 运行 `npm run release:local -- --version X.Y.Z --push`。
4. 检查 commit、`vX.Y.Z` tag、Gitea Release 和容器镜像。

版本号由 `package.json` 管理，`scripts/set_version.mjs` 同步其他文件。已有 tag 保持不可变。

发布前可运行 `npm run release:doctor -- --online` 汇总环境问题。Git 默认不签名，显式 `--sign` 启用；开发目录工具缓存、状态查询与故障恢复见 [发布工程](docs/contracts/release-engineering.md)。
