# Module Inventory

| Module | Responsibility | Dependencies | Files | Lines | Complexity | S.U.P.E.R Score |
|:-------|:---------------|:-------------|------:|------:|:-----------|:----------------|
| Frontend Application Shell | 页面状态、视图渲染、交互流程、API 调用、打印与导出入口 | Browser APIs, backend HTTP API | 1 | 11384 | Critical | `S🔴 U🟡 P🔴 E🟡 R🔴` |
| Frontend Styling System | 全局布局、模块样式、打印样式、响应式适配 | DOM class contract | 1 | 4217 | High | `S🟡 U🟢 P🟡 E🟢 R🟡` |
| Backend Service Core | HTTP 路由、持久化、权限、审计、结算、流程、索引与兼容迁移 | Python stdlib, SQLite, runtime files | 1 | 6533 | Critical | `S🔴 U🟡 P🔴 E🟡 R🔴` |
| Build and Release Scripts | 版本同步、离线打包、索引生成、演示数据生成、本地发布 | Node, bash, Python runtime | 8 | 800+ | Medium | `S🟡 U🟢 P🟡 E🟡 R🟡` |
| Documentation System | 使用说明、部署说明、API 模型、开发规范、演示说明 | Markdown, Gitea Wiki sync | 20+ | 3000+ | Medium | `S🟢 U🟢 P🟡 E🟢 R🟡` |
| Deployment and CI | Docker image build, compose deployment, Gitea workflows | Docker, Gitea Actions | 5+ | 300+ | Medium | `S🟡 U🟢 P🟡 E🟡 R🟡` |

> **S.U.P.E.R Score**: Rate each module as 🟢 (compliant), 🟡 (partial), or 🔴 (violation) based on the five principles. Format: `S🟢 U🟡 P🔴 E🟢 R🟡`

## Module Details

### Frontend Application Shell
- **Path**: `src/app.js`
- **Responsibility**: 承载整个前端应用的状态、渲染、交互、接口调用、缓存和导出入口
- **Public API**: DOM event handlers, render pipeline, fetch wrappers, billing/intake/workflow actions
- **Internal Dependencies**: `src/styles.css`, `index.html` DOM structure
- **External Dependencies**: Browser DOM APIs, Fetch API, Storage APIs, print window APIs
- **Complexity Rating**: Critical
- **Transformation Notes**: 这是当前最大耦合点。视图、状态、业务判断、网络请求、缓存控制聚在单文件里，后续拆分需要先定义显式状态契约和 API ports。
- **S.U.P.E.R Assessment**:
  - **S (Single Purpose)**: 同时承担页面壳、业务流程、数据加载、表单校验、打印和提示，职责明显过宽。
  - **U (Unidirectional Flow)**: 存在状态写入后多处回流渲染，数据流方向可描述，但边界不稳。
  - **P (Ports over Implementation)**: 大量接口契约隐含在调用代码和服务端返回结构里，显式 schema 较少。
  - **E (Environment-Agnostic)**: 本地静态模式、共享模式、打印模式并存，已有环境分支，仍需把模式切换收敛成明确配置层。
  - **R (Replaceable Parts)**: 当前替换任一业务面板、状态层或请求层都会影响大量调用点，替换成本高。

### Frontend Styling System
- **Path**: `src/styles.css`
- **Responsibility**: 提供全局视觉系统、模块布局、打印样式和响应式适配
- **Public API**: CSS class names consumed by `src/app.js` and `index.html`
- **Internal Dependencies**: DOM structure defined by frontend rendering functions
- **External Dependencies**: Browser CSS features
- **Complexity Rating**: High
- **Transformation Notes**: 已具备统一视觉语言，后续要继续按模块分段和打印场景分层，降低全局样式串扰。
- **S.U.P.E.R Assessment**:
  - **S**: 大体围绕样式职责展开，打印、浮层、布局仍然集中在单文件。
  - **U**: 依赖方向清晰，CSS 只被消费。
  - **P**: 依赖前端 class 命名约定，建议补模块级样式契约。
  - **E**: 浏览器环境一致，环境耦合较低。
  - **R**: 可替换性中等，模块样式边界再清晰一些会更稳。

### Backend Service Core
- **Path**: `server.py`
- **Responsibility**: 提供 HTTP API、SQLite 存储、权限控制、审计、导入、结算和流程跟踪
- **Public API**: `/api/*` routes plus shared helper functions used by scripts
- **Internal Dependencies**: runtime data files, release metadata, system config
- **External Dependencies**: Python stdlib modules, SQLite engine, OS filesystem
- **Complexity Rating**: Critical
- **Transformation Notes**: 路由、仓储、领域逻辑、兼容修复和汇总计算都在单文件里。后续拆分需要先定义 repository/service/schema 边界，再移动实现。
- **S.U.P.E.R Assessment**:
  - **S**: 路由、存储、权限、结算、流程、导入、缓存在单文件并存。
  - **U**: 逻辑层级能辨认，实际实现仍有跨层直接访问和共享结构。
  - **P**: 多数返回 JSON 可序列化，接口契约仍以内联字典为主。
  - **E**: 环境变量和默认配置已有基础，文件路径和本地 runtime 假设仍散落在实现中。
  - **R**: 当前替换存储层、认证层或流程层会波及大量内部函数。

### Build and Release Scripts
- **Path**: `scripts/`
- **Responsibility**: 处理版本同步、离线打包、IACUC 索引生成、演示数据生成、本地发布
- **Public API**: `set_version.mjs`, `release_local.sh`, `package_offline.sh`, `generate_iacuc_index.py`, `generate_demo_data.py`
- **Internal Dependencies**: `package.json`, `src/app.js`, release files, runtime data
- **External Dependencies**: Node.js, bash, Python runtime
- **Complexity Rating**: Medium
- **Transformation Notes**: 整体方向清晰，后续重点是把输入输出契约写清楚，减少脚本对文件内容格式的隐含依赖。
- **S.U.P.E.R Assessment**:
  - **S**: 单脚本单职责整体较好。
  - **U**: 方向清晰，脚本调用链简单。
  - **P**: 少量文件内容解析依赖隐式文本模式，建议补契约。
  - **E**: 本地工具链依赖明确，shell 兼容性要继续关注。
  - **R**: 替换性中等，脚本之间耦合较小。

### Documentation System
- **Path**: `README.md`, `AGENTS.md`, `wiki/*`, `docs/*`
- **Responsibility**: 对用户、代理、部署者和汇报场景提供统一文档
- **Public API**: Markdown documentation and Gitea Wiki sync
- **Internal Dependencies**: project structure, release behavior, business semantics
- **External Dependencies**: Gitea Wiki sync workflow
- **Complexity Rating**: Medium
- **Transformation Notes**: 当前文档基线已足够支撑规范化，后续要让架构契约、分层规则和执行进度并入正式文档体系。
- **S.U.P.E.R Assessment**:
  - **S**: 文档类型清晰。
  - **U**: 依赖方向稳定。
  - **P**: 缺少架构契约页和模块边界页。
  - **E**: 环境耦合低。
  - **R**: 替换性良好。

### Deployment and CI
- **Path**: `Dockerfile`, `docker-compose.yml`, `docker-compose.offline.yml`, `.gitea/workflows/*`
- **Responsibility**: 支撑镜像构建、部署、发布、Wiki 同步
- **Public API**: Compose commands and Gitea Actions workflows
- **Internal Dependencies**: package scripts, repo layout, release tags
- **External Dependencies**: Docker, Gitea runners, registry credentials
- **Complexity Rating**: Medium
- **Transformation Notes**: 当前部署链可用，后续要把 release contract、image contract、wiki sync contract 写成固定规范。
- **S.U.P.E.R Assessment**:
  - **S**: 职责明确。
  - **U**: 依赖方向清晰。
  - **P**: 部分 workflow 约定尚未形成清晰契约文档。
  - **E**: runner 环境差异和 shell 差异仍需显式约束。
  - **R**: 中等，可替换性取决于发布链契约清晰度。
