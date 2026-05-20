# Module Inventory

> Baseline: CageLedger `0.5.2c`

| Module | Responsibility | Dependencies | Files | Lines | Complexity | S.U.P.E.R Score |
|:-------|:---------------|:-------------|------:|------:|:-----------|:----------------|
| Frontend Application Shell | 页面状态、视图渲染、交互流程、API 调用、打印导出入口 | Browser APIs, backend HTTP API | 1 | 11537 | Critical | `S🔴 U🟡 P🔴 E🟡 R🔴` |
| Frontend Styling System | 全局布局、模块样式、打印样式、响应式适配 | DOM class contract | 1 | 4624 | High | `S🟡 U🟢 P🟡 E🟢 R🟡` |
| Backend Service Core | HTTP 路由、SQLite、权限、审计、迁移、结算、待进驻 | Python stdlib, SQLite, runtime files | 1 | 6425 | Critical | `S🔴 U🟡 P🔴 E🟡 R🔴` |
| Backend Infrastructure Helpers | 配置、数据库连接、缓存、JSON 响应辅助 | Python stdlib | 5 | 170 | Medium | `S🟢 U🟢 P🟡 E🟢 R🟡` |
| Build and Release Scripts | 版本同步、离线打包、索引生成、演示数据、本地发布 | Node, bash, Python | 8+ | 800+ | Medium | `S🟡 U🟢 P🟡 E🟡 R🟡` |
| Gitea Automation | Release package、container package、Wiki sync | Gitea Actions, Docker, registry credentials | 3 | 150+ | Medium | `S🟡 U🟢 P🟡 E🟡 R🟡` |
| Documentation System | Wiki、开发规范、spec-driven 分析/计划/进度 | Markdown, Gitea Wiki sync | 30+ | 4000+ | Medium | `S🟢 U🟢 P🟡 E🟢 R🟡` |

## Frontend Application Shell

- **Path**: `src/app.js`
- **Responsibility**: 全局状态、页面渲染、视图切换、API 请求、表单处理、笼卡打印、结算导出、系统信息和站内反馈。
- **Key State Areas**: bootstrap infrastructure, intake batches, placement tasks, quantity sheets, billing workflows, audit logs, system update, UI flags.
- **Key Contracts**: [Frontend State Contract](../contracts/frontend-state.md), [API Contracts](../contracts/api-contracts.md).
- **Transformation Notes**: 先抽 `api/client`，再抽 state slices，最后按页面迁移 view modules。
- **S.U.P.E.R Assessment**:
  - **S**: app shell、业务逻辑、视图和接口调用集中在单文件。
  - **U**: `scheduleRender` 和 lazy loading 已形成主路径，局部写入与补拉仍需状态 helper 固化。
  - **P**: API shape 与 state shape 已在本轮契约化，代码层仍待迁移。
  - **E**: shared/static/print 模式均已支持，模式能力需要集中定义。
  - **R**: 页面模块、API 调用和状态写入的替换成本仍高。

## Frontend Styling System

- **Path**: `src/styles.css`
- **Responsibility**: 页面布局、卡片、列表、笼位图、待接收/待进驻列表、打印样式、响应式规则。
- **Public API**: class names consumed by `index.html` and `src/app.js`.
- **Transformation Notes**: 前端 view 拆分时保留现有 class contract，按业务区块整理样式段落。
- **S.U.P.E.R Assessment**:
  - **S**: 样式职责集中明确，单文件规模偏大。
  - **U**: CSS 只被 DOM 消费，依赖方向清晰。
  - **P**: class contract 依赖约定，后续按 view module 固化。
  - **E**: 浏览器环境一致。
  - **R**: 模块级样式边界清晰后可替换性提升。

## Backend Service Core

- **Path**: `server.py`
- **Responsibility**: HTTP handler、SQLite schema/migration、repository-like helpers、service-like workflows、permission、audit、cache、Gitea update check。
- **Key Services**: intake receipt confirmation, placement reserve/move-in/reassign, quantity transfer sync, billing statement/workflow, IACUC upload.
- **Key Contracts**: [API Contracts](../contracts/api-contracts.md), [Module Boundaries](../contracts/module-boundaries.md).
- **Transformation Notes**: Phase 2 按 `config/db/repositories/services/contracts/http` 顺序迁移，保持 `server.py` 作为兼容入口。
- **S.U.P.E.R Assessment**:
  - **S**: 多层职责集中。
  - **U**: route/service/repository 层级可辨认，实际函数仍混合。
  - **P**: JSON shape 已被文档化，代码层仍以内联 dict 为主。
  - **E**: env/path/update config 可抽到 config helper。
  - **R**: 存储层、认证层、业务服务替换成本高。

## Backend Infrastructure Helpers

- **Path**: `server_app/`
- **Responsibility**: `config.py` 管理环境变量和路径；`db.py` 管理连接和初始化门闩；`cache.py` 管理短时缓存与性能日志；`http.py` 管理通用响应头和 JSON 响应。
- **Public API**: imported by `server.py`.
- **Transformation Notes**: 这是 Phase 2 Task 2.1 的输出，后续 repository/service 拆分继续放在 `server_app/` 下。
- **S.U.P.E.R Assessment**:
  - **S**: 每个 helper 文件职责单一。
  - **U**: `server.py` 依赖 helper，helper 不依赖业务实现；`db.py` 通过 initializer callback 连接 schema 初始化。
  - **P**: helper API 已显式命名，后续可补类型和返回 shape。
  - **E**: 环境变量集中在 `config.py`。
  - **R**: 缓存、响应、数据库连接均可单独替换。

## Build and Release Scripts

- **Path**: `scripts/`
- **Responsibility**: `set_version.mjs`、`release_local.sh`、offline package、IACUC index、demo data。
- **Public API**: npm scripts in `package.json`.
- **Transformation Notes**: Phase 4 固化脚本输入输出和 release contract。
- **S.U.P.E.R Assessment**:
  - **S**: 单脚本职责整体清晰。
  - **U**: 版本同步与发布顺序清晰。
  - **P**: 文件内容解析仍依赖文本约定。
  - **E**: shell、Node、Python 环境要求需要继续文档化。
  - **R**: 脚本替换成本中等。

## Gitea Automation

- **Path**: `.gitea/workflows/`
- **Responsibility**: tag 发布离线包、推送容器镜像、同步 `wiki/**` 到 Gitea Wiki。
- **Credentials**: `GITEA_TOKEN`, `PACKAGE_USERNAME`, `PACKAGE_PAT`.
- **Transformation Notes**: 修改 workflow 时同时考虑 runner 网络、job container shell、registry login、Wiki remote。
- **S.U.P.E.R Assessment**:
  - **S**: 三个 workflow 职责清晰。
  - **U**: tag/main 触发路径明确。
  - **P**: release/package/wiki sync contract 需要在 Phase 4 固化。
  - **E**: runner 与 job container 环境差异需要显式约束。
  - **R**: 基于 Gitea 语义，可替换性依赖 contract 完整度。

## Documentation System

- **Path**: `README.md`, `AGENTS.md`, `wiki/*`, `docs/*`, `.codex-run/skills/*`
- **Responsibility**: 用户文档、部署文档、API/数据模型、开发规范、spec-driven 执行计划和进度。
- **Transformation Notes**: `wiki/` 继续作为正式用户/运维入口，`docs/` 作为内部规范化执行包。
- **S.U.P.E.R Assessment**:
  - **S**: 文档面向对象已经分层。
  - **U**: Wiki 与 spec docs 依赖方向清晰。
  - **P**: 本轮新增 contracts 补齐架构契约入口。
  - **E**: Markdown 环境通用。
  - **R**: 文档模块替换成本低。
