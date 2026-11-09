# CageLedger 代理工作规范

适用于仓库及子目录。保留项目特有边界；具体实现与验证按任务查阅下方契约。

## 完成标准与自主执行

- 以用户当前目标为范围，完成实现、相关验证和由本次改动造成的问题修复后再交付；用户只要求分析或方案时，交付对应结果。
- 处理中收到补充要求或问题时，结合上下文调整并继续原目标；只有用户明确取消或替换目标时才结束原任务。完成状态以实际交付和验证为准。
- 可自行定位文件、选择常规实现、编辑和运行本地检查，无需在计划或首版实现后等待确认。相关改动集中完成后统一验证，不每改一个小点就运行检查；已通过的检查只在其覆盖范围受新改动影响、出现失败或仍有具体风险时重跑。
- 业务规则存在实质性歧义、缺失关键输入或需要未获授权的外部操作时才澄清；用户已经明确的规则和授权无需再次确认。提交、推送、发布和生产数据操作按用户授权范围执行；整理代码不代表授权发布。
- 云端每轮修改完成并通过相关验证后，及时提交并推送到 Gitea 对应开发分支，避免未推送代码仅保存在云端磁盘。用户已授权这一日常代码备份流程；推送前核对远端并保留其他改动，不强推。构建、打标签、发布与生产部署仍按各自授权执行。
- 只读取当前任务相关的契约和 Skill。小修正不要求全仓扫描、阶段计划、评分或进度遥测。已有任务跟踪仅在确实属于该任务时更新；`docs/archives/` 是历史资料，不恢复为活动任务。
- 用户要求优先于 Skill 建议。若某条规则导致暂停，指出具体文件、原文和需要用户决定的事项；不把建议自行解释为审批要求。
- 交付用简洁中文说明改动、验证结果和未验证项；涉及页面时附实际本地地址，未启动时说明。

## 代理分工

- 主代理与子代理使用 Codex 官方默认模型、推理强度和上下文设置，由客户端选择。主代理负责规划与最终审查，子代理执行范围明确的任务。
- 小修复由主代理直接完成，不默认启动多代理审查。只有边界清楚、预计能减少主代理工作量的实现任务才委派，默认最多一个执行子代理；子代理不继续委派。
- 委派时提供目标、相关文件、允许修改范围、业务约束与验收条件，避免复制全部历史或要求重复全仓扫描。子代理返回修改文件、检查命令及结果、未解决问题，不以自述成功代替证据。
- 结算、减免、权限、数据库迁移等关键判断由主代理负责；主代理检查实际 diff、验收覆盖与必要的测试证据后交付。同一问题连续两轮修复仍失败，或发现业务歧义与越界依赖时，交回主代理处理。
- 检查与打包复用现有脚本；未改动且已通过的检查不重复运行。发布授权仍遵守现有边界。具体维护规则见 `docs/contracts/agent-instructions.md`。

## 当前实现核对

当前版本、页面入口与兼容代码的核对从 [current-baseline.md](docs/contracts/current-baseline.md) 开始。代码审查先追踪导航／快捷入口、实际 View、hook 和 HTTP 调用链；文件存在、测试引用或兼容导出不能证明当前页面可达。报告区分现役流程、兼容 API 与未接入的历史组件，不能把孤立组件测试的结果扩大为当前用户流程。

## 项目入口

React 19 / TypeScript / Vite，服务端状态由 TanStack Query 管理，列表使用 TanStack Virtual。Python 标准库 HTTP 服务与 SQLite 提供后端，生产页面和 `/api` 由同一服务提供。

| 任务                     | 入口与按需契约                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首次安装、启动、分支     | [CONTRIBUTING.md](CONTRIBUTING.md)；Node 版本见 `.nvmrc`，Python 见 `.python-version`；云端入口见 [cloud-development.md](docs/contracts/cloud-development.md)                                     |
| 模块定位、跨层修改       | [module-boundaries.md](docs/contracts/module-boundaries.md)；前端 `src/react/features/`，后端 `server_app/domains/`，`server.py` 为装配及兼容入口                                                 |
| React 状态、Query、请求  | [frontend-state.md](docs/contracts/frontend-state.md)、[api-contracts.md](docs/contracts/api-contracts.md)；请求在 `src/react/api/`，新类型在 `src/contracts/`                                    |
| UI、表单、弹窗、布局     | [ui-component-standard.md](docs/contracts/ui-component-standard.md)、[ui-interaction-system.md](docs/contracts/ui-interaction-system.md)、[style-ownership.md](docs/contracts/style-ownership.md) |
| 通知、操作结果、任务反馈 | [ui-feedback.md](docs/contracts/ui-feedback.md)；Notification／Message／Alert 分类、异步与重试边界及全系统盘点                                                                                    |
| 颜色、主题               | [ui-color-system.md](docs/contracts/ui-color-system.md)、[antd-design-language.md](docs/contracts/antd-design-language.md)                                                                        |
| API 写入、权限、迁移     | [write-safety.md](docs/contracts/write-safety.md)、[api-contracts.md](docs/contracts/api-contracts.md)                                                                                            |
| 测试、浏览器、打印、性能 | [testing-strategy.md](docs/contracts/testing-strategy.md) 中对应任务条目                                                                                                                          |
| 格式、lint、架构门禁     | [code-quality.md](docs/contracts/code-quality.md)                                                                                                                                                 |
| 文档或代理指令维护       | [documentation-system.md](docs/contracts/documentation-system.md)、[agent-instructions.md](docs/contracts/agent-instructions.md)                                                                  |
| 发布                     | [开发规范](wiki/开发规范.md)、[发布工程](docs/contracts/release-engineering.md)、[branching.md](docs/contracts/branching.md)、`scripts/release_local.sh`                                          |

日常入口：`npm run dev`，按影响范围使用 `test:target`、`test:related`、`test:python:target` 并指定目标；交付按影响选择检查；`check`、`verify:full` 仅在明确选择该完整范围时执行。开发页面 `http://localhost:5173`，API `http://127.0.0.1:5174`；页面异常先确认这两个端口的进程归属。项目 Python 命令通过 `scripts/run_python.mjs` 使用 `.venv`，可由 `CAGELEDGER_PYTHON_BIN` 覆盖。

## 业务边界

- IACUC 是笼卡、占用、数量统计表和结算链路的核心业务键。
- Animal Record ID 是笼卡实例的持久唯一标识，后续实验、繁殖、取材记录继续沿用该标识。
- `项目来源` 是财务字段 `funding` 的 source of truth。
- “已取材”和“设为空”保留独立业务语义。
- 数量统计表是当前正式饲养费结算来源；动态笼位图计费代码及历史视图仍保留，默认菜单不开放为正式结算入口。现役笼位管理不受此限制。
- 数量统计表转入转出需要同步目标伦理、镜像记录和结算结果。
- 项目负责人减免按 PI 总额度、IACUC 有效期、优先减免设置和逐日笼数动态分配。
- 结算单按月、按项目负责人汇总；IACUC 和设施保留为明细维度。
- 当前报销登记与补录在“结算管理 → 单据跟踪”完成；流程阶段与锁定归档分别表达。旧报销台账、应收和核销 API 及历史数据保留，不能据此推断当前工作台仍有旧四页签。
- 房间管理员的设施写权限按授权房间控制；数量统计表跨房间录入、结算导出和发起流程按现行业务授权执行。
- 涉及结算、权限、转移和状态推进的修改同时验证前端、API、SQLite 和审计日志。

## 工程与数据边界

- 开发只使用默认分支 `main`、下一大版本分支 `beta` 和预发布整合分支 `rc`。当前版本修复及小功能直接在 `main` 开发、提交和推送，不另建临时开发分支。具体分工见 [分支策略](docs/contracts/branching.md)。
- 页面通过 typed hooks 访问服务端；TanStack Query 管业务数据，UI reducer 只管显示偏好，高频表单草稿留在局部。业务写入精确失效查询键。
- handler 管鉴权与响应，领域 service 管事务、校验、审计与缓存，repository 管 SQL 和兼容读写。新增业务进入 `server_app/domains/`，不扩大历史兼容层。
- 不直接修改 SQLite、WAL 和运行时 JSON；不手工编辑 `data/`、`web-dist/`、`dist/`、`node_modules/`。测试使用隔离数据，不能仅凭 localhost 判断数据可丢弃。
- 不删除旧字段、payload 或兼容迁移，除非任务明确包含迁移方案；schema 迁移保持幂等和旧库回填。
- UI 使用 Ant Design 组件与唯一主题定义，视觉尺度、对比度及响应式规则见 `docs/contracts/antd-design-language.md`。布局以 `src/styles/style-ownership.json` 登记的唯一来源为准，`src/styles.css` 仅作导入入口。
- UI 验证按测试契约区分局部小改与结构性改动；文案、间距、提示位置等小改默认只确认受影响页面，不默认四档视口、截图矩阵或完整回归。通知和确认使用站内组件。
- 结算汇总表同时检查 `src/react/print/settlement.ts` 与 `server_app/pdf/documents.py`，保留前端和 Python 的等价回归，尤其是跨页汇总。
- 日常修改、提交和推送只做与改动相关的验证；简单修改不运行完整 `npm run check`、`npm run verify:full`、生产构建或打包。结算、权限、迁移等高风险改动按影响范围补充回归，不因提交而自动升级为全量检查。发布验收按风险补充缺失检查；完整回归仅在明确要求或共享基础变更需要时执行；Mac mini 可选手动备用；同一最终代码状态已通过的结果可复用，发布脚本必需的校验仍保留。所有文件修改完成后运行一次 `git diff --check`。具体范围以 [测试策略](docs/contracts/testing-strategy.md) 为准。

## Skill 与发布边界

按实际能力选择技能，不固定串联。Ant API 查询用 `antd`；CageLedger UI 一致性审查用 `antd-ui-audit`；巡检目录草稿、发布或图片维护用 `inspection-catalog-editor`。动画审查、设计方案、选库等专项技能只在对应需求下使用，具体路由见各 Skill 描述。复杂跨模块工作在会话提供时可用 `spec-driven-develop`，普通修改不因关键词触发完整规划流程。

发布源头是 `package.json`，版本由 `scripts/set_version.mjs` 同步；更新说明写入 `wiki/更新日志.md`，运行 `npm run release:notes:sync` 生成系统记录。云端 Git/API 使用 `https://git.cellnucle.us/hugo/cageledger`，兼容原 HTTP 直连入口，镜像为 `ddns.cellnucle.us:3333/hugo/cageledger:<tag>`。

Codex 云端负责日常开发、验收、按影响范围的测试和 ARM64 构建，继续推送 Gitea Packages；Gitea 托管代码、Packages 和 Release。生产目标为 DS223（aarch64），只构建 `linux/arm64`，历史 AMD64 制品保留。离线源码包以后由 Gitea 本地构建，Codex 不上传；本地临时源码包仍可用于来源核验。运行环境由 `runtime-image.lock.json` 固定到不可变摘要，受管构建直接复用已验证的依赖层；依赖输入变化时明确失败，只有显式 `npm run runtime:refresh` 才刷新和发布新的内容寻址运行时镜像，不移动业务版本或 `latest`。保留缓存，不能用每次重新安装 apt/pip 代替锁定依赖。

正式云端发布先完成版本与更新记录、相关验收、同一提交的 ARM64 构建/冒烟、代码及附注标签推送和 Packages 核验，再运行 `npm run release:cloud -- --publish`。该命令校验已有标签、产物及 Packages 凭据并发表 Release，不自动执行前述准备步骤；Release 只附小型来源与摘要清单和拉取指引。需要离线交付时显式加 `--offline-image` 才上传镜像分片并完整回读 SHA256；开发草稿入口 `publish:cloud` 同样必须显式选此开关。默认发布不再上传约 600 MiB 的离线整包，不用 Release 附件替代 Packages。只复用来源、摘要及身份一致的凭据，不覆盖既有版本、标签或其他发布模式的 receipt。发布成功后才能显式更新 `latest`。代码、测试与产物对应同一发布源码，普通修改和推代码不自动打包或发布。生产部署与环境发布分别按用户授权执行。

使用现有 checkout 和独立 Gitea remote；云端流程见 [cloud-development.md](docs/contracts/cloud-development.md)。Mac mini Runner 仅作手动备用，配置见 [macos-gitea-runner.md](docs/contracts/macos-gitea-runner.md)。`release:local` 保留 Mac 平台专用转换器信任及完整正式发布配置，不能据此声称该管线已全部迁移到 Linux。测试范围按风险选择，受管云端保持宿主锁、cgroup 资源保护、单组浏览器/单 worker、隔离数据和退出核对；同一输入已通过的检查不重复运行。发布默认不签名，按需显式启用，不修改个人 Git 签名配置。

## 测试执行约束

- 日常按“本次 diff → 影响模块/风险 → 明确测试目标”选择检查。文案、样式小改、提交或推送不触发全量测试；不得为追求测试数量新增重复、只匹配措辞或复述实现的用例。新增覆盖优先选择能验证行为的最轻层。
- 使用 `test:target`、`test:related`、`test:python:target` 并提供明确目标；静态依赖选择无法覆盖动态/跨语言关系时补充相关模块，不能将零用例当通过或静默转为全量。失败先定位再重跑，已通过且未受改动影响的结果不重复执行。
- 跨浏览器门禁以稳定标签和独立清单核对覆盖，不按测试标题文案选择；保持业务断言、上下文隔离和浏览器退出证据，具体规则见测试策略。
- Mac mini 16GB 固定单组浏览器、单 worker；禁止同时运行多套验证、Docker 构建/预热或大模型推理。完整检查及浏览器使用受管入口，不直接调用 `check:steps` 或后台拼接命令绕过宿主机锁和资源保护；warning/critical 内存压力时停止本次任务。
- 交付报告实际范围、通过/失败/未运行项。资源中止不算通过；不得靠增大超时、重试直到变绿或删测绕过。测试选择、用例治理与官方依据统一见 [测试策略](docs/contracts/testing-strategy.md)。
- 发布默认不签名，需要时显式 `--sign`；保留推送认证、制品校验和完整门禁，不修改个人 Git 签名配置。
