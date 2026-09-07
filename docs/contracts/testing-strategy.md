# 测试策略

## 按改动选择验证

此处是开发验证的统一入口。一次任务只执行相关条目；通过后不重复运行已覆盖的检查。提交和发布前仍必须运行 `npm run check`，发布按完整门禁执行。

| 改动                              | 开发中最低验证                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 纯 Markdown、代理指令、Skill 文本 | 修改文件的 Prettier、Markdownlint、相对链接与引用路径；Skill 校验；`git diff --check`。Wiki 变更还需 `npm run check:docs` |
| 工具配置、依赖、脚本              | 相关工具或脚本实际运行；涉及共用门禁时运行 `npm run check`                                                                |
| 纯业务计算、后端实现              | 对应 Vitest 或 Python 回归；实现完成后 `npm run check`                                                                    |
| React 交互                        | `npm run check` 与目标页面浏览器验收                                                                                      |
| UI 样式与响应式                   | 下方 UI 回归流程；纯文档中的 UI 说明不触发页面验收                                                                        |
| API、权限、缓存、迁移             | `npm run check`、`npm run smoke:api`、管理员与房间管理员路径                                                              |
| 打印、PDF                         | 对应模板回归、预览、A4 页数与多页定位；结算遵守下方双渲染契约                                                             |
| 关键业务链                        | 对应 Playwright 回归；跨域影响或发布时运行完整 `npm run test:e2e`                                                         |
| 大列表、查询、加载性能            | `npm run benchmark`；下方性能历史对比与分页、虚拟化、查询计划检查                                                         |

本地检查及本次改动引起的失败修复可连续执行，不在每一步等待确认。使用测试框架建立的临时库和 fixtures；API 冒烟或浏览器写入前核实服务和数据目录，不能将运行库当作测试库。环境缺失或历史失败要如实记录，不扩大到无关修复。

不为低风险文字改动编写只匹配措辞的测试。测试应验证可观察的行为或业务约束，复用已有回归覆盖。

## 分层

| 层级        | 工具                                | 重点                                             |
| ----------- | ----------------------------------- | ------------------------------------------------ |
| 纯业务单元  | Vitest                              | 日期、笼卡、数量统计表、解析和计算               |
| React 组件  | Testing Library、Vitest             | 表单、状态、局部交互和可访问语义                 |
| Python 单元 | unittest                            | 业务规则、兼容函数和数据转换                     |
| API 冒烟    | `scripts/smoke_api.mjs`             | 鉴权、读写、权限和关键响应                       |
| 浏览器回归  | Playwright                          | 用户流程、权限、弹窗、移动端和公开扫码           |
| 可访问性    | `@axe-core/playwright`              | 登录、核心页面和典型弹窗的 serious/critical 问题 |
| 打印与 PDF  | 模板单元测试、PDF 解析、浏览器预览  | A4、物理页数、空白页、页脚、二维码和固定尺寸     |
| 性能        | benchmark、性能历史、浏览器性能记录 | SQLite 查询、分页、虚拟列表和首屏加载            |

## 结算汇总表双渲染链路

结算汇总表不是单一模板出口，修改时必须把以下两条链路视为同一份业务契约：

- 前端预览和“直接打印”由 `src/react/print/settlement.ts` 生成。
- 服务端 PDF、后台 PDF 任务和批量导出由 `server_app/pdf/documents.py` 生成。

涉及字段、计费结果、汇总、分页、列宽、说明或页脚的修改，需要同时更新两端实现，并分别在 `src/react/print/printTemplates.test.ts` 和 `tests/test_pdf_exports.py` 添加等价断言。多页结算单至少覆盖：第一页汇总包含后续页同品种伦理，逐日笼数、减免、梯度、缴纳金额和单项合计一致，预览与导出 PDF 的物理页数及页码一致。只验证其中一个出口不得作为完成依据。

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

适用于实际 UI 改动，覆盖受影响组件和状态。任务开始运行一次 `npm run check:antd-design` 与 `npm run check:style-ownership`；后续 `npm run check` 已包含这两项，不额外重复。

1. 使用 `rg` 枚举目标组件的 class、data attribute、媒体查询和导入顺序，记录唯一布局归属。
2. 在桌面、1180px、760px、手机横屏验证目标页面的默认、焦点、禁用、加载和长文本状态。
3. 检查浏览器 computed style 与容器溢出，重点覆盖 `display`、网格列、最小宽度、间距、定位和层级。
4. 运行目标 CSS 的 Stylelint、`npm run check` 和 `git diff --check`；关键流程补充或更新 Playwright 截图断言。
5. 视觉差异先回溯样式来源和级联顺序，再修改唯一组件规则。验收禁止新增同类覆盖层。
6. 按 [`ui-change-evidence.md`](../templates/ui-change-evidence.md) 保存组件归属、四档视口、溢出与 computed style 证据。

同组表单读取实际存在的 DatePicker、Select、Input 与只读 Input 的 computed style，统一外框高度档位：默认 32px、紧凑 24px、强调 40px。同一行只用一种档位。Portal 检查 `.app-modal-root` 的实际样式作用域；保持单一纵向滚动所有者。修改交互、权限、打印、导出、缓存或加载链路时，浏览器检查实际用户入口。

## 完整门禁

`npm run verify:full` 在基础质量检查后执行 React 应用与 VitePress 文档站的生产构建，并执行完整 Playwright。E2E 使用临时 SQLite，测试数据不会写入正式数据库。

VitePress 文档使用 `wiki/` 作为唯一源目录。`npm run release:notes:sync` 从 `wiki/更新日志.md` 生成系统“关于”页使用的更新记录；发布脚本同时校验 Markdown 版本条目和生成结果。

## 业务回归

- 笼卡：识别、保存、打印、接收、回退和待进驻生成。
- 笼位：授权房间、预留、正式入驻、设为空和 Animal Record ID 延续。
- 数量统计表：多类型录入、日期、转入转出镜像、保存、预览和导出。
- 结算：按 PI 合表、IACUC 有效期、逐日减免、全额减免、PDF 和流程发起。
- 单据跟踪：结算流程筛选、登记归档、补录报销单和撤回/撤销。
- 权限：管理员与房间管理员分别验证前端入口和 API 状态码。
- 系统状态：管理员性能快照与历史记录、PDF 队列与缓存指标、手动刷新、普通账号不请求指标、空样本、四档视口与 Axe。
- 性能改动：缓存、索引、SQLite 查询、PDF 渲染、批量操作或首屏加载改动前后，读取相同时间窗口的 `/api/system/performance-history`，记录版本、HTTP/SQLite P95、慢请求、锁错误和结论；同时运行 `npm run benchmark`。历史数据只能用于管理员趋势与验收，采样不得进入请求链路，也不得包含用户、请求参数或 SQL。

## 发布验证分工

Mac mini 执行格式、lint、类型、Vitest、Python 全量测试、应用与文档生产构建、Playwright、PDF/打印验收、API 冒烟和性能 benchmark。浏览器报告与测试结果保留在本地发布验证记录中。Gitea 保存 Git 代码、Wiki 迁移页、Release 资产和容器镜像。
