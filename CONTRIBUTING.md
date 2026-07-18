# 参与 CageLedger 开发

本文说明本地环境、代码边界、质量检查和提交要求。业务口径以 `AGENTS.md` 和 `docs/contracts/` 为准。

## 环境

- Node.js 22，建议使用 `.nvmrc`：`nvm use`。
- Python 3.13，版本文件为 `.python-version`。
- ShellCheck，macOS 使用 `brew install shellcheck` 安装。
- Python 依赖分为运行依赖 `requirements.txt` 和开发依赖 `requirements-dev.txt`。

```bash
npm ci
python3 -m pip install -r requirements-dev.txt
npm run dev
```

开发页面为 `http://localhost:5173`，Vite 将 `/api` 代理到 `http://127.0.0.1:5174`。

## 分支和提交

- 从最新 `main` 创建短生命周期分支。
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

## 测试矩阵

| 改动                   | 最低验证                                  |
| ---------------------- | ----------------------------------------- |
| 文档、配置、低风险样式 | `npm run check`、`git diff --check`       |
| React 交互             | 上述检查和目标页面浏览器验收              |
| API、权限、缓存、迁移  | 上述检查、`npm run smoke:api`、双角色验证 |
| 打印和 PDF             | 模板测试、预览、A4 页数与多页定位         |
| 关键业务链             | `npm run test:e2e`                        |
| 大列表和查询性能       | `npm run benchmark`                       |

基础质量检查：

```bash
npm run check
```

完整发布验证：

```bash
npm run verify:full
```

Gitea Pull Request 运行轻量质量门禁：格式、lint、类型、Vitest、构建和架构检查。Mac mini 在发布前运行 Python 全量测试、Playwright、API 冒烟与 PDF 验收。

## 可访问性

- 图标按钮提供可访问名称。
- label 与输入控件建立关联，错误信息使用 `aria-invalid` 和描述关系。
- 弹窗进入时移动焦点，支持 Tab 约束和 Escape 关闭，关闭后恢复触发按钮焦点。
- 展开控件提供 `aria-expanded` 和 `aria-controls`。
- toast、加载和错误状态使用合适的 live region。

## 发布

1. 在 `src/react/releaseNotesCurrent.ts` 增加版本、日期和时间。
2. 运行 `npm run release:local -- --version X.Y.Z --push`。
3. 检查 commit、`vX.Y.Z` tag、Gitea Release 和容器镜像。

版本号由 `package.json` 管理，`scripts/set_version.mjs` 同步其他文件。已有 tag 保持不可变。
