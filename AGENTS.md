# CageLedger 代理工作规范

本文件面向代码代理，作用范围是当前项目根目录及其子目录。目标是保证修改与现有业务模型、运行方式、发布流程一致。

## 1. 项目概览

- 这是一个实验动物笼位管理与饲养费核算系统。
- 前端是原生 HTML/CSS/JavaScript：
  - `index.html`
  - `src/app.js`
  - `src/styles.css`
- 后端是 Python 标准库 HTTP 服务：
  - `server.py`
- 默认存储是 SQLite：
  - `data/cageledger.sqlite`
- 核心业务包括：
  - 动态笼位图
  - 占用记录
  - IACUC 索引
  - 数量统计表
  - 饲养费结算
  - 结算流程跟踪
  - 笼卡管理

## 2. 启动与验证

- 共享模式启动命令：
  - `npm run dev`
- 静态模式启动命令：
  - `npm run static`
- 语法检查命令：
  - `npm run check`
- 离线包命令：
  - `npm run package:offline`
- 本地发布命令：
  - `npm run release:local -- --version X.Y.Z --push`
- 默认本地访问地址：
  - `http://localhost:5173`
- 修改后优先运行 `npm run check`。
- 涉及页面交互、缓存、权限、加载流程、打印、导出时，额外确认 `http://localhost:5173` 的实际表现。
- 如果本地页面行为异常，先检查 `5173` 端口是否还是旧进程，再决定是否排查代码。

## 3. 代码入口与改动归属

- 前端主逻辑集中在 `src/app.js`。
- 前端样式集中在 `src/styles.css`。
- 后端 API、SQLite、权限、迁移、审计逻辑集中在 `server.py`。
- 接口与数据模型说明以 `docs/API.md` 为准。
- Docker、NAS、离线部署说明以 `docs/DEPLOYMENT.md` 为准。
- 用户操作手册以 `docs/USER_MANUAL.md` 为准。
- 版本号源头在 `package.json`。
- 版本同步入口是 `scripts/set_version.mjs`。
- 本地顺序化发布入口是 `scripts/release_local.sh`。
- 远端仓库与制品发布当前基于私有 Gitea：
  - 仓库地址：`https://git.cellnucle.us/hugo/cageledger`
  - 工作流目录：`.gitea/workflows/`
  - 镜像仓库：`git.cellnucle.us/hugo/cageledger`
- `dist/` 是打包产物目录。
- `data/` 是运行数据目录。
- 除非任务明确要求，否则不要手工编辑 `dist/` 和 `data/`。

## 4. 业务约束

- IACUC 是贯穿笼位、数量统计表、结算链路的核心业务键。
- `项目来源` 是财务字段 `funding` 的 source of truth；导入 CSV、后端解析和离线索引脚本都必须保持一致。
- “已取材”和“设为空”是两种不同业务动作，语义必须分开保留。
- 房间管理员只能操作授权饲养间。
- 系统管理员维护账号、数据管理、房间基础信息和全局配置。
- 数量统计表和动态笼位图是两条并存的数据入口。
- 饲养费导出、结算流程、流程中心展示必须与结算数据链路一致。
- 只修 UI 而不修数据链路会制造假一致，涉及结算、转入转出、流程状态时要同时检查前后端行为。
- 历史兼容逻辑有业务价值，迁移、旧库兼容、旧字段回填都要谨慎处理。
- 结算流程属于月度结算单，不属于单个笼位占用生命周期；当前核心状态链为：
  - `in_feeding`
  - `statement_generated`
  - `statement_sent`
  - `statement_signed_returned`
  - `submitted_to_finance`

## 5. 开发规则

- 优先沿用现有写法和已有抽象。
- 少引入新框架、新状态层、新构建工具。
- 前端通知统一走站内通知与站内确认弹层。
- 不使用浏览器原生 `alert()` 和 `confirm()`。
- 远端模式和本地静态模式都要考虑。
- 修改缓存、bootstrap、懒加载、权限、SQLite 迁移、索引、版本刷新逻辑时，必须在结果里说明验证情况。
- 修改版本号时只用仓库脚本，不手工散改多个文件。
- 发布前先更新 `src/app.js` 中的 `SYSTEM_RELEASE_NOTES`。
- 发布时要求 `commit -> version -> tag -> Release/Packages` 严格一一对应；不要复用旧 tag 修补新内容。
- “系统更新”功能按 Gitea 最新 Release 判断，不按 `main` 最新 commit 判断；涉及更新检查时先确认 Release 语义没有被改回分支语义。
- 私有 Gitea 更新检查依赖 `CAGELEDGER_UPDATE_CHECK_ENABLED=true` 和只读 `CAGELEDGER_GITEA_TOKEN`。
- Gitea 发布链当前分工：
  - `GITEA_TOKEN` 用于创建 Release
  - `PACKAGE_USERNAME` / `PACKAGE_PAT` 用于推送容器镜像
- 修改 `.gitea/workflows/*` 时，额外考虑 runner 是否只能访问内网资源、job 容器与 runner 容器网络是否一致、脚本是否兼容 `/bin/sh`。
- 如果修改影响接口、数据结构、部署说明，连带更新对应 `docs/` 文档。

## 6. 禁止事项

- 不随意重写 `src/app.js` 的整体结构。
- 不删除历史兼容逻辑，除非任务明确要求。
- 不手工改 `dist/` 打包产物。
- 不直接改 SQLite 数据文件内容。
- 不跳过 `npm run check` 就提交或发布。
- 不在未确认的情况下更改结算规则、负责人减免逻辑、IACUC 匹配语义。
- 不因为前端显示正确就默认后端链路正确。
- 不把运行时生成的数据、缓存文件、数据库文件作为常规代码修改对象。
- 不把 `main` 上尚未发版的 commit 当成用户可安装更新。
- 不把 Gitea Variables 与 Secrets 混用成同一语义；敏感令牌默认优先使用 Secrets。

## 7. 交付要求

- 回答里要明确：
  - 改了什么
  - 验证了什么
  - 没验证什么
- 如果重启过本地服务，要说明当前访问地址。
- 如果执行了发布，要说明：
  - 版本号
  - tag
  - 提交号
  - 主分支推送结果
  - 标签推送结果
- 如果发现问题来自旧进程、缓存、权限、旧库兼容，要明确指出根因。

## 8. 常见任务模板

- 跑起来：
  - 先检查 `5173` 端口和现有进程
  - 再执行 `npm run dev`
- 修前端：
  - 主要改 `src/app.js` 和 `src/styles.css`
  - 完成后运行 `npm run check`
  - 涉及交互时再确认 `http://localhost:5173`
- 修后端：
  - 主要改 `server.py`
  - 完成后运行 `npm run check`
  - 涉及接口和权限时检查对应 API 与前端联动
- 发版：
  - 先更新 `src/app.js` 中的 `SYSTEM_RELEASE_NOTES`
  - 再执行 `npm run release:local -- --version ... --push`
- 改更新检查：
  - 先确认目标是“最新 Release”还是“最新 commit”
  - 私有仓库场景下同时验证有 token 与无 token 两条返回路径
- 改发布链：
  - 同时检查 `.gitea/workflows/release-package.yml`
  - 同时检查 `.gitea/workflows/publish-container.yml`
  - 关注 Gitea Release、Gitea Container Registry、runner 标签和镜像登录凭据

## 9. 项目级固定事实

- 默认本地地址是 `http://localhost:5173`。
- 默认管理员初始化来自环境变量。
- 未覆盖时默认账号密码是：
  - 用户名：`admin`
  - 密码：`admin123`
- 当前仓库以 `v*` tag 作为正式发布出口。
- 版本同步入口是 `scripts/set_version.mjs`。
- 发布顺序入口是 `scripts/release_local.sh`。
- 当前正式上游是私有 Gitea，不再是 GitHub。
- 当前正式容器镜像地址是 `git.cellnucle.us/hugo/cageledger:<tag>`。
- `docker-compose.yml` 的在线部署路径应优先使用私有 Gitea 镜像；`docker-compose.offline.yml` 才是源码构建路径。
- 在线部署只要求目标机器能访问 `git.cellnucle.us`；源码构建和 runner 构建环境是否完全内源化，要单独审计基础镜像与包管理器来源。
- 接口与部署细节分别以 `docs/API.md`、`docs/DEPLOYMENT.md` 为准。
- 项目文档和业务说明优先使用中文。

## 10. 文档风格要求

- 修改仓库文档时优先用中文。
- 规则写法优先使用“规则 + 一句解释”。
- 命令、路径、接口名直接写成可执行或可定位形式。
- 避免写成泛泛的团队口号。
- 让首次进入仓库的代理只读本文件就知道怎么启动、怎么检查、怎么发布、哪些地方不能乱动。
