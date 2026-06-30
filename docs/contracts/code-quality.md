# 代码质量契约

## 目标

本契约定义仓库内活动代码和文档的统一质量检查。代码提交需要可格式化、可 lint、可测试，并保持既有业务语义。

## 版本基线

- Node.js 22.12 或更高的 22.x 版本。
- Python 3.13。
- npm 依赖以 `package-lock.json` 为准。
- Python 运行依赖以 `requirements.txt` 为准，开发工具以 `requirements-dev.txt` 为准。

## 文件规则

| 文件        | 工具                         | 规则                                                 |
| ----------- | ---------------------------- | ---------------------------------------------------- |
| TS、TSX、JS | Prettier、ESLint、TypeScript | 双引号、分号、2 空格、120 字符、严格类型             |
| CSS         | Prettier、Stylelint          | 语义变量、标准属性和值、保留现有业务 class           |
| Python      | Ruff                         | Python 3.13、4 空格、120 字符、import 排序           |
| Markdown    | Prettier、Markdownlint       | 标题层级、代码块语言、有效链接；中文行宽不限制       |
| Shell       | Bash、ShellCheck             | `#!/usr/bin/env bash`、`set -euo pipefail`、变量引用 |
| YAML、JSON  | Prettier                     | 2 空格、LF、UTF-8                                    |

批量格式化排除 `docs/archives/`、`src/vendor/`、`web-dist/`、`dist/`、`data/` 和生成目录。

## S.U.P.E.R 边界

- Single Purpose：模块和函数承担单一职责。
- Unidirectional Flow：依赖指向稳定内层，数据沿输入、处理、输出方向流动。
- Ports over Implementation：跨模块交互使用显式类型和可序列化契约。
- Environment-Agnostic：路径、地址和凭据来自配置或环境变量。
- Replaceable Parts：API、repository、service、打印模板和 UI 层保持可替换边界。

## 前端审查

- 页面通过 `src/react/api/` typed hooks 访问业务数据。
- mutation 精确失效查询键，频繁输入保持局部草稿。
- React 页面按业务域懒加载，避免串行请求 waterfall 和重复全量加载。
- 交互控件具备键盘、焦点、名称和状态语义。
- 颜色、按钮和状态遵守 `ui-color-system.md`。

## 后端审查

- handler 处理鉴权、参数、状态码和响应装配。
- service 处理业务校验、事务、审计和缓存失效。
- repository 处理 SQL、分页、索引和 payload 兼容。
- schema 迁移幂等，旧库启动后自动补齐。
- 新列表接口提供服务端分页、筛选和稳定排序。

## 命令

```bash
npm run format
npm run check
npm run verify:full
git diff --check
```
