# CageLedger 代理工作规范

本文件面向代码代理，作用范围是仓库根目录及全部子目录。修改代码、文档、部署和发布流程时，先遵守本文件。

## 1. 当前架构

- CageLedger 是实验动物笼卡、笼位、数量统计表、饲养费结算和报销台账系统。
- 前端使用 React 19、TypeScript、Vite、TanStack Query 和 TanStack Virtual。
- 前端入口是 `index.html`、`src/main.tsx` 和 `src/react/App.tsx`。
- 后端使用 Python 标准库 HTTP 服务，入口是 `server.py`。
- 后端分层位于 `server_app/repositories/` 和 `server_app/services/`。
- 默认存储是 SQLite，运行库位于 `data/cageledger.sqlite`。
- 生产前端构建到 `web-dist/`，Python 服务统一提供页面和 `/api`。

## 2. 安装、启动与验证

- Node.js 版本要求：`>=22.12.0`，使用 `.nvmrc`。
- Python 版本要求：`3.13`，使用 `.python-version`。
- 首次安装：`npm ci` 和 `python3 -m pip install -r requirements-dev.txt`。
- 开发模式：`npm run dev`。
  - Vite 页面：`http://localhost:5173`
  - Python API：`http://127.0.0.1:5174`
  - Vite 将 `/api` 代理到 Python API。
- 生产构建：`npm run build`。
- 本地生产运行：`npm start`。
- 类型检查：`npm run typecheck`。
- 单元与后端测试：`npm run test`、`python3 -m unittest discover -s tests -p 'test_*.py'`。
- 基础质量检查：`npm run check`。
- 完整发布验证：`npm run verify:full`。
- 浏览器回归：`npm run test:e2e`。
- API 冒烟：`npm run smoke:api`。
- 性能基准：`npm run benchmark`。
- 离线包：`npm run package:offline`。
- 发布：`npm run release:local -- --version X.Y.Z --push`。

页面异常时先检查 `5173` 和 `5174` 的进程归属。修改交互、权限、打印、导出、缓存和加载链路后，使用浏览器验证实际页面。

## 3. 代码归属

| 领域         | 主要路径                            | 责任                                             |
| ------------ | ----------------------------------- | ------------------------------------------------ |
| 应用装配     | `src/main.tsx`、`src/react/App.tsx` | Provider、会话入口、公开扫码入口                 |
| 工作区外壳   | `src/react/features/shell/`         | 导航、权限可见性、懒加载页面                     |
| 业务页面     | `src/react/features/`               | 页面编排、表单状态、用户交互                     |
| 通用组件     | `src/react/components/`             | 可复用工作区组件和表格组件                       |
| 服务端状态   | `src/react/api/`                    | typed contracts、请求、Query hooks、查询键和失效 |
| 本地 UI 状态 | `src/react/state/`                  | 当前页面、导航折叠、界面偏好存储                 |
| 纯业务函数   | `src/domain/`                       | 日期、笼位、笼卡、数量统计表等纯计算             |
| 打印与导出   | `src/react/print/`                  | 笼卡、二维码、数量统计表和结算单模板             |
| 全局样式     | `src/styles.css`                    | 语义变量、布局、组件状态和打印外层样式           |
| HTTP 入口    | `server.py`                         | 路由、鉴权、参数解析、兼容迁移和响应装配         |
| 数据访问     | `server_app/repositories/`          | SQLite 查询、分页、结构化列和 payload 兼容       |
| 业务服务     | `server_app/services/`              | 接收、入驻、转移、结算、报销等事务流程           |
| 正式文档     | `wiki/`                             | 使用、部署、运维和公开开发说明                   |
| 工程契约     | `docs/contracts/`                   | 模块边界、状态、API 和 UI 语义规范               |
| 迁移归档     | `docs/archives/`                    | 已完成项目记录，仅作历史依据                     |

`web-dist/` 是 Vite 构建产物，`dist/` 是离线发布包目录，`data/` 是运行数据目录。常规代码任务不手工编辑这些目录。

## 4. 前端规则

- 页面通过 `src/react/api/` 的 typed hooks 访问服务端数据。
- 服务端业务数据由 TanStack Query 管理；业务写入成功后失效精确查询键。
- 本地 UI reducer 只保存导航和显示偏好，不保存笼卡、笼位、统计表和结算数据。
- 表单草稿优先留在页面组件，频繁输入使用局部 state 或 ref，避免整页查询失效和失焦。
- 可复用纯计算放入 `src/domain/` 并补 Vitest。
- 打印模板放入 `src/react/print/`，预览与实际打印共享同一份模板。
- 页面级功能通过 `React.lazy` 保持按业务域拆包。
- 通知和确认统一使用站内组件；页面代码不调用浏览器原生 `alert()`、`confirm()`。
- 颜色使用 `src/styles.css` 的语义变量，规则见 `docs/contracts/ui-color-system.md`。
- 新增图标优先沿用现有图标系统，保持按钮尺寸、焦点环和语义色一致。

## 5. 后端规则

- HTTP handler 负责鉴权、输入解析、状态码和响应装配。
- service 负责跨表事务、业务校验、缓存失效和审计语义。
- repository 负责 SQL、分页、结构化列、payload 兼容和行级读写。
- 新写入接口返回前端局部刷新所需的最新对象和受影响对象。
- 新列表接口使用服务端分页、筛选和稳定排序。
- SQLite schema 迁移保持幂等，旧库启动后自动补字段、索引和必要回填。
- 修改缓存、索引、迁移或权限时，交付说明要写明验证路径。
- `server.py` 仍承担路由和兼容入口；新增业务优先进入现有 service/repository 边界。

## 6. 业务约束

- IACUC 是笼卡、占用、数量统计表和结算链路的核心业务键。
- Animal Record ID 是笼卡实例的持久唯一标识，后续实验、繁殖、取材记录继续沿用该标识。
- `项目来源` 是财务字段 `funding` 的 source of truth。
- “已取材”和“设为空”保留独立业务语义。
- 数量统计表和动态笼位图是并存的结算数据入口。
- 数量统计表转入转出需要同步目标伦理、镜像记录和结算结果。
- 项目负责人减免按 PI 总额度、IACUC 有效期、优先减免设置和逐日笼数动态分配。
- 结算单按月、按项目负责人汇总；IACUC 和设施保留为明细维度。
- 结算流程与报销台账并行：流程记录单据状态，台账记录应缴、已缴和累计未缴。
- 房间管理员的设施写权限按授权房间控制；数量统计表跨房间录入、结算导出和发起流程按现行业务授权执行。
- 涉及结算、权限、转移和状态推进的修改同时验证前端、API、SQLite 和审计日志。

## 7. API 与状态约束

- 通用请求入口是 `src/react/api/client.ts`。
- 可复用响应类型集中在 `src/react/api/contracts.ts`。
- 查询键集中在 `src/react/api/queryKeys.ts`。
- 默认查询缓存：`staleTime=15s`、`gcTime=5min`、查询重试一次、窗口聚焦不自动刷新。
- 列表响应使用 `{ items, page }`，单对象响应优先使用 `{ item }`。
- 错误响应使用 `{ error: string }`。
- Cookie Session 由 `/api/auth/*` 管理，401 进入登录态处理。
- 完整约束见 `docs/contracts/frontend-state.md` 和 `docs/contracts/api-contracts.md`。

## 8. 修改与验证要求

- 前端交互：运行 `npm run check`，再验证目标页面。
- API、权限、缓存或迁移：运行 `npm run check` 和 `npm run smoke:api`，再验证管理员与房间管理员路径。
- 打印与 PDF：运行模板测试，并检查预览、打印页数、A4 尺寸和多页定位。
- 大列表或性能：运行 `npm run benchmark`，检查分页、虚拟化和查询计划。
- 关键业务链：根据风险运行 `npm run test:e2e`。
- 所有文件修改完成后运行 `git diff --check`。
- 交付说明包含改动、已验证项、未验证项和当前本地地址。

## 9. 发布与 Gitea

- 正式上游：`https://git.cellnucle.us/hugo/cageledger`。
- 正式镜像：`git.cellnucle.us/hugo/cageledger:<tag>`。
- 正式版本出口：`v*` tag、Gitea Release 和同版本容器镜像。
- 版本源头：`package.json`。
- 版本同步：`scripts/set_version.mjs`。
- 更新记录：`src/react/releaseNotes.ts` 中的 `SYSTEM_RELEASE_NOTES`。
- 发布入口：`scripts/release_local.sh`。
- 发布顺序保持 `release notes -> check -> offline package -> commit -> tag -> push`。
- 系统更新检查以 Gitea 最新 Release 为准。
- 私有仓库更新检查使用 `CAGELEDGER_UPDATE_CHECK_ENABLED=true` 和只读 `CAGELEDGER_GITEA_TOKEN`。
- Gitea 工作流位于 `.gitea/workflows/`，`wiki/**` 推送到 `main` 后同步到 Gitea Wiki。

## 10. 固定事实与禁止事项

- 默认管理员来自环境变量，缺省值为 `admin / admin123`。
- 默认生产端口是 `5173`。
- Docker 使用 Node 构建阶段和 Python 运行阶段。
- 在线部署使用 `docker-compose.yml`，离线源码构建使用 `docker-compose.offline.yml`。
- 不直接修改 SQLite 文件、WAL 文件和运行时 JSON。
- 不手工修改 `web-dist/`、`dist/`、`data/` 和 `node_modules/`。
- 不删除旧字段、旧 payload 和兼容迁移逻辑，除非任务明确包含数据迁移方案。
- 不改变结算、减免、IACUC 匹配和权限口径，除非用户明确确认业务规则。
- 不跳过 `npm run check` 执行提交或发布。
- 不复用旧 tag 修补新版本。

## 11. 文档维护

- 用户流程、部署、配置和公开接口更新到 `wiki/`。
- 代码边界、状态管理、API 约束和视觉语义更新到 `docs/contracts/`。
- 已完成迁移资料保留在 `docs/archives/`，后续开发以当前代码和当前契约为准。
- 文档命令、路径、端口和环境变量需要可以直接执行或定位。
- 项目文档和业务说明优先使用中文。

## 12. Skill 使用矩阵

| 任务                                 | 必用 Skill                       | 执行重点                                                                                |
| ------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------- |
| 大型功能、迁移、重构、跨模块数据模型 | `spec-driven-develop`            | 先分析和拆解；私有 Gitea 或 `LOCAL_ONLY` 跟踪；完成资料归档到 `docs/archives/`          |
| React、Query、性能和包体             | `vercel-react-best-practices`    | 采用适用于 Vite 客户端的规则；检查 waterfall、动态导入、重渲染、localStorage 和事件监听 |
| 页面、组件和视觉交互                 | `frontend-design`                | 延续青绿色、高密度、安静的运营工作台风格                                                |
| 按钮、表单、弹窗、菜单、Tab 和焦点   | `fixing-accessibility`           | 检查名称、label、键盘流、焦点恢复、ARIA 和对比度                                        |
| 自动化页面回归                       | `webapp-testing`                 | 仓库内 TypeScript Playwright 测试是权威自动化入口                                       |
| localhost 快速验收                   | `browser:control-in-app-browser` | 检查页面、控制台、网络和截图                                                            |
| 打印和 PDF                           | `pdf:pdf`                        | 渲染检查 A4、尺寸、页数和二维码                                                         |
| CSV、XLSX 和模板                     | `spreadsheets:Spreadsheets`      | 保留表头、公式、格式和导入兼容                                                          |
| README、Wiki、发布记录和用户文案     | `humanizer-zh`                   | 使用自然、直接、可执行的中文                                                            |

Skill 服从用户要求、业务规则、本文件和 `docs/contracts/`。UI 任务按 `frontend-design -> fixing-accessibility -> vercel-react-best-practices -> webapp-testing` 的顺序实施和验收。

## 13. 工程质量基线

- 新代码满足 S.U.P.E.R：单一职责、单向依赖、显式契约、环境无关和可替换边界。
- Prettier、ESLint、Stylelint、Markdownlint 和 Ruff 是统一格式与 lint 来源。
- `npm run check` 是提交和发布前的基础质量检查。
- `npm run verify:full` 执行基础质量检查、生产构建和完整 Playwright。
- Gitea CI 对 `main` 的推送和 Pull Request 执行前端质量、Python 质量和 E2E 三个 job。
- 完整规则见 `CONTRIBUTING.md`、`docs/contracts/code-quality.md` 和 `docs/contracts/testing-strategy.md`。
