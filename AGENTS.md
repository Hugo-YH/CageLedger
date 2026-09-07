# CageLedger 代理工作规范

适用于仓库及子目录。保留项目特有边界；具体实现与验证按任务查阅下方契约。

## 完成标准与自主执行

- 以用户当前目标为范围，完成实现、相关验证和由本次改动造成的问题修复后再交付；用户只要求分析或方案时，交付对应结果。
- 可自行定位文件、选择常规实现、编辑和运行本地检查，无需在计划或首版实现后等待确认。测试通过后，只有新改动、失败或未解决风险才触发重跑或扩大验证。
- 只有业务规则变更、缺失的关键输入或未获授权的外部操作才需要澄清。提交、推送、发布和生产数据操作按用户授权范围执行；整理代码不代表授权发布。
- 只读取当前任务相关的契约和 Skill。小修正不要求全仓扫描、阶段计划、评分或进度遥测。已有任务跟踪仅在确实属于该任务时更新；`docs/archives/` 是历史资料，不恢复为活动任务。
- 用户要求优先于 Skill 建议。若某条规则导致暂停，指出具体文件、原文和需要用户决定的事项；不把建议自行解释为审批要求。
- 交付用简洁中文说明改动、验证结果和未验证项；涉及页面时附实际本地地址，未启动时说明。

## 项目入口

React 19 / TypeScript / Vite，服务端状态由 TanStack Query 管理，列表使用 TanStack Virtual。Python 标准库 HTTP 服务与 SQLite 提供后端，生产页面和 `/api` 由同一服务提供。

| 任务                     | 入口与按需契约                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首次安装、启动、分支     | [CONTRIBUTING.md](CONTRIBUTING.md)；Node 版本见 `.nvmrc`，Python 见 `.python-version`                                                                                                             |
| 模块定位、跨层修改       | [module-boundaries.md](docs/contracts/module-boundaries.md)；前端 `src/react/features/`，后端 `server_app/domains/`，`server.py` 为装配及兼容入口                                                 |
| React 状态、Query、请求  | [frontend-state.md](docs/contracts/frontend-state.md)、[api-contracts.md](docs/contracts/api-contracts.md)；请求在 `src/react/api/`，新类型在 `src/contracts/`                                    |
| UI、表单、弹窗、布局     | [ui-component-standard.md](docs/contracts/ui-component-standard.md)、[ui-interaction-system.md](docs/contracts/ui-interaction-system.md)、[style-ownership.md](docs/contracts/style-ownership.md) |
| 颜色、主题               | [ui-color-system.md](docs/contracts/ui-color-system.md)、[antd-design-language.md](docs/contracts/antd-design-language.md)                                                                        |
| API 写入、权限、迁移     | [write-safety.md](docs/contracts/write-safety.md)、[api-contracts.md](docs/contracts/api-contracts.md)                                                                                            |
| 测试、浏览器、打印、性能 | [testing-strategy.md](docs/contracts/testing-strategy.md) 中对应任务条目                                                                                                                          |
| 格式、lint、架构门禁     | [code-quality.md](docs/contracts/code-quality.md)                                                                                                                                                 |
| 文档或代理指令维护       | [documentation-system.md](docs/contracts/documentation-system.md)、[agent-instructions.md](docs/contracts/agent-instructions.md)                                                                  |
| 发布                     | [开发规范](wiki/开发规范.md)、[branching.md](docs/contracts/branching.md)、`scripts/release_local.sh`                                                                                             |

常用命令：`npm run dev`、`npm run check`、`npm run build`。开发页面 `http://localhost:5173`，API `http://127.0.0.1:5174`；页面异常先确认这两个端口的进程归属。项目 Python 命令通过 `scripts/run_python.mjs` 使用 `.venv`，可由 `CAGELEDGER_PYTHON_BIN` 覆盖。

## 业务边界

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

## 工程与数据边界

- 页面通过 typed hooks 访问服务端；TanStack Query 管业务数据，UI reducer 只管显示偏好，高频表单草稿留在局部。业务写入精确失效查询键。
- handler 管鉴权与响应，领域 service 管事务、校验、审计与缓存，repository 管 SQL 和兼容读写。新增业务进入 `server_app/domains/`，不扩大历史兼容层。
- 不直接修改 SQLite、WAL 和运行时 JSON；不手工编辑 `data/`、`web-dist/`、`dist/`、`node_modules/`。测试使用隔离数据，不能仅凭 localhost 判断数据可丢弃。
- 不删除旧字段、payload 或兼容迁移，除非任务明确包含迁移方案；schema 迁移保持幂等和旧库回填。
- UI 使用现有 Ant Design 组件与语义 Token：主色 `#1677ff`、4px 间距、14px 正文、6px 控件圆角、8px 容器圆角、32px 默认控件高度。布局以 `src/styles/style-ownership.json` 登记的唯一来源为准，`src/styles.css` 仅作导入入口。
- 修改布局、表单、表格、导航、弹窗或浮层，按测试契约保留四档视口与 computed style 证据。通知和确认使用站内组件。
- 结算汇总表同时检查 `src/react/print/settlement.ts` 与 `server_app/pdf/documents.py`，保留前端和 Python 的等价回归，尤其是跨页汇总。
- 提交和发布前必须通过 `npm run check`；所有文件修改完成后运行 `git diff --check`。开发中按测试契约选择检查，不要求每次编辑后运行全套。

## Skill 与发布边界

按实际能力选择技能，不固定串联。Ant API 查询用 `antd`；CageLedger UI 一致性审查用 `antd-ui-audit`；巡检目录草稿、发布或图片维护用 `inspection-catalog-editor`。动画审查、设计方案、选库等专项技能只在对应需求下使用，具体路由见各 Skill 描述。复杂跨模块工作可用 `spec-driven-develop`，普通修改不因关键词触发完整规划流程。

发布源头是 `package.json`，版本由 `scripts/set_version.mjs` 同步；更新说明写入 `wiki/更新日志.md`，运行 `npm run release:notes:sync` 生成系统记录。正式上游为 `http://ddns.cellnucle.us:3333/hugo/cageledger`，镜像为 `ddns.cellnucle.us:3333/hugo/cageledger:<tag>`。

发布入口为 `npm run release:local -- --version X.Y.Z --push`，保持 `release notes → check → offline package → commit → tag → push` 的顺序。Mac mini 是发布验证、制品生成、Release 上传和 Wiki 同步执行端；Gitea 托管代码、Wiki、Release 和镜像。版本出口为 `v*` tag、Gitea Release 和同版本镜像，不复用旧 tag。
