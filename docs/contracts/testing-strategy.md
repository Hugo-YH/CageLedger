# 测试策略

## 分层

| 层级        | 工具                      | 重点                                             |
| ----------- | ------------------------- | ------------------------------------------------ |
| 纯业务单元  | Vitest                    | 日期、笼卡、数量统计表、解析和计算               |
| React 组件  | Testing Library、Vitest   | 表单、状态、局部交互和可访问语义                 |
| Python 单元 | unittest                  | 业务规则、兼容函数和数据转换                     |
| API 冒烟    | `scripts/smoke_api.mjs`   | 鉴权、读写、权限和关键响应                       |
| 浏览器回归  | Playwright                | 用户流程、权限、弹窗、移动端和公开扫码           |
| 可访问性    | `@axe-core/playwright`    | 登录、核心页面和典型弹窗的 serious/critical 问题 |
| 打印与 PDF  | 模板单元测试、浏览器预览  | A4、14 张笼卡、分页、二维码和固定尺寸            |
| 性能        | benchmark、浏览器性能记录 | SQLite 查询、分页、虚拟列表和首屏加载            |

## 快速门禁

`npm run check` 执行格式检查、全部 lint、TypeScript 类型检查、Vitest 和 Python unittest。开发依赖需要提前安装：

```bash
npm ci
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm run check
```

`npm run dev` 和 `npm run test:e2e` 使用项目 `.venv` 的 Python 启动 API，避免继承 macOS 系统 Python。`CAGELEDGER_PYTHON_BIN` 可指定其他 Python 3.13 可执行文件。

## UI 回归流程

1. 使用 `rg` 枚举目标组件的 class、data attribute、媒体查询和导入顺序，记录唯一布局归属。
2. 在桌面、1180px、760px、手机横屏验证目标页面的默认、焦点、禁用、加载和长文本状态。
3. 检查浏览器 computed style 与容器溢出，重点覆盖 `display`、网格列、最小宽度、间距、定位和层级。
4. 运行目标 CSS 的 Stylelint、`npm run check` 和 `git diff --check`；关键流程补充或更新 Playwright 截图断言。
5. 视觉差异先回溯样式来源和级联顺序，再修改唯一组件规则。验收禁止新增同类覆盖层。
6. 每次 UI 变更执行 `npm run check:style-ownership`，并按 [`ui-change-evidence.md`](../templates/ui-change-evidence.md) 保存组件归属、四档视口、溢出与 computed style 证据。

## 完整门禁

`npm run verify:full` 在基础质量检查后执行 React 应用与 VitePress 文档站的生产构建，并执行完整 Playwright。E2E 使用临时 SQLite，测试数据不会写入正式数据库。

VitePress 文档使用 `wiki/` 作为唯一源目录。`npm run release:notes:sync` 从 `wiki/更新日志.md` 生成系统“关于”页使用的更新记录；发布脚本同时校验 Markdown 版本条目和生成结果。

## 业务回归

- 笼卡：识别、保存、打印、接收、回退和待进驻生成。
- 笼位：授权房间、预留、正式入驻、设为空和 Animal Record ID 延续。
- 数量统计表：多类型录入、日期、转入转出镜像、保存、预览和导出。
- 结算：按 PI 合表、IACUC 有效期、逐日减免、全额减免、PDF 和流程发起。
- 流程中心：台账筛选、报销登记、部分缴纳、完成和删除。
- 权限：管理员与房间管理员分别验证前端入口和 API 状态码。

## 发布验证分工

Mac mini 执行格式、lint、类型、Vitest、Python 全量测试、应用与文档生产构建、Playwright、PDF/打印验收、API 冒烟和性能 benchmark。浏览器报告与测试结果保留在本地发布验证记录中。Gitea 保存 Git 代码、Wiki 迁移页、Release 资产和容器镜像。
