# Codex 云端开发、构建与 Gitea 交付

Codex 云端负责日常开发、验收、按影响范围的测试和交付任务的软件包构建；代码及产物推送到 Gitea，由 Gitea 托管代码和软件包。Mac mini Runner 仅作可选手动备用，见 [备用配置](macos-gitea-runner.md)。生产目标为群晖 DS223（aarch64），后续只构建离线源码包、ARM64 镜像与离线镜像包；历史 AMD64 制品保留。构建、提交、推送、上传、发布环境与生产部署分别按任务授权执行。

## 进入现有检出

```bash
cd /workspace/CageLedger
source scripts/cloud_env.sh
node --version
npm --version
python --version
git status --short
```

使用现有检出；云任务已隔离，不额外创建 worktree 或临时功能分支。平台初始 `work` 仅作为导入分支，核对提交和现有修改后进入 `main`，不重置或丢弃工作区。长期分支继续遵循 [分支策略](branching.md)。

保留平台 GitHub `origin` 供环境仓库恢复；添加独立 Gitea remote 后显式操作 `gitea`，避免推错上游。不要盲目覆盖已有同名 remote。

```bash
git remote add gitea https://git.cellnucle.us/hugo/cageledger.git
node scripts/run_python.mjs scripts/gitea_git.py ls-remote gitea HEAD
node scripts/run_python.mjs scripts/gitea_git.py fetch gitea
```

Gitea 是日常代码上游，GitHub `origin` 仅保留为平台导入入口。新任务开始先 fetch 并比较 `gitea/<当前分支>` 与 HEAD；工作区干净且仅落后时可 `git merge --ff-only gitea/<当前分支>`。有本地修改、分叉或未知引用时先分析并保留现场，不重置、不盲目覆盖未跟踪文件。

网络密钥 `CAGELEDGER_GITEA_TOKEN` 在环境设置中绑定 `git.cellnucle.us`。包装器仅为子进程追加 HTTPS 主机限定认证头，保留平台已有 Git 认证和代理，不将值写进文件或命令参数。不要把占位符编码成 Basic 凭据、写入 credential store 或用于 HTTP 地址。推送需任务授权，推送前核对远端状态与待推送提交，不强推。

## 工具与依赖

Node 使用 22.x（当前验证 22.23.3），npm 使用 11.21.1，Python 使用 3.13。运行和开发依赖分别以 `requirements.txt`、`requirements-dev.txt` 为准；项目 Python 命令自动选择 `.venv`。

```bash
npm ci --no-audit --no-fund
uv venv --python python3.13 --allow-existing .venv
uv pip install --python .venv/bin/python -r requirements-dev.txt
npx playwright install chromium firefox webkit
```

没有 uv 时可用支持 ensurepip 的 Python 创建 venv 并通过 pip 安装。ShellCheck 由开发依赖提供，激活脚本把 `.venv/bin` 加入 PATH。浏览器使用当前锁定的 Playwright 版本；系统 Chromium 不能替代锁定安装。

Linux 还需浏览器系统库、中文字体、Poppler 与可执行的 LibreOffice Writer。先检查现有能力；有系统安装权限时使用 `npx playwright install-deps` 和发行版包管理器。非 root 云用户不能假定有 sudo；缺失依赖须明确诊断，不能跳过校验来报告通过。开发转换器可用不等同于正式发布转换器已满足供应链信任要求。

## 开发、验收与测试

```bash
CAGELEDGER_EPHEMERAL_DB=1 npm run dev
```

此命令启动临时数据库、Vite、Python API 和文档服务；关闭时清理本次临时数据。端口默认 5173/5174/5175。启动前检查端口归属，不终止未知进程，不从生产目录复制凭据或数据库。

测试范围统一遵循 [测试策略](testing-strategy.md)，不重复建立一套云端业务门禁：

```bash
npm run test:target -- src/domain/intake.test.ts
npm run test:python:target -- tests.test_intake_order_identifiers
npm run test:e2e -- tests/e2e/login-navigation.spec.ts
```

Linux 的受管检查使用 cgroup v2 有限内存配额、OOM 事件及 swap 监测，保留互斥锁、单 worker、独立数据库和进程清理。定向单元/API 测试只做一次准入；完整和浏览器检查保留稳定观察。`npm run check`、`npm run verify:full` 留到发布前或明确要求全量时执行；所有所需依赖和用例必须实际完成，不能将 dry-run 或单元测试通过描述为浏览器验收。

## 云端受管构建

只有明确要求构建或交付的任务才执行打包；普通开发修改、提交或代码推送仍只做按影响范围的测试，不自动升级为全量或软件包构建。云端执行：

```bash
python scripts/setup_cloud_builder.py
export CAGELEDGER_BUILDX_BUILDER=cageledger-cloud
npm run package:managed
```

`package:managed` 共用宿主锁和资源保护，串行执行 `package:offline` 与 `package:container`。前者构建应用与文档并生成 `dist/CageLedger-offline-<version>.tar.gz`；后者仅构建 `linux/arm64`，直接导出 `docker load` 兼容镜像包、加载说明和 SHA256，校验通过后才替换最终产物。打包入口本身不上传，不与受管浏览器或其他重任务重叠。交付时复用同一最终源码状态的有效测试证据，记录确切来源 revision；构建后出现新修改须重新判断测试与产物是否失效，不能将脏工作区产物仅标记成旧 HEAD 的干净构建。

Docker/Buildx 必须具有 ARM64 构建能力，能力不足明确失败。当前云端 rootless Docker 的默认 builder 不能据 binfmt 注册成功就判定可构建 ARM64。初始化命令使用固定摘要的官方 BuildKit、现有代理和 CA，创建独立 `cageledger-cloud` builder，每次实际运行 ARM64 指令探针；不切换全局 Docker context、不修改宿主 binfmt，也不重启未知 daemon。

`cloud_env.sh` 默认选择该 builder，并显式设置 `CAGELEDGER_BUILD_PRUNE=1`，在 ARM64 导出校验后清理专用 builder 缓存以控制磁盘使用。通用入口默认不清缓存，拒绝对默认或未知 builder 清理。环境恢复后必要时重新初始化；BuildKit ARM64 构建成功不等同于宿主 Docker 可以直接运行 ARM64 容器。

可选的 Mac mini 备用构建仅手动触发，使用原生 ARM64 Docker Desktop／Colima context，保留缓存，不套用云端激活脚本和 builder 配置。

Docker 网络构建保持代理与 TLS 验证，使用 BuildKit secret 临时挂载所需 CA；会话证书和凭据不得进入最终镜像。Git/API 站点由 `CAGELEDGER_GITEA_URL` 选择，镜像仓库独立由现有 registry 配置选择，不能用改 Git URL 的方式更改镜像流量路径。

## Gitea 托管与发布边界

明确交付任务将对应代码和 ARM64 产物推送到 Gitea。普通构建产物可使用 Gitea Packages 的唯一开发版本托管，并保存离线源码包、ARM64 离线镜像、加载说明、SHA256 及来源清单；这不等同于正式 Release 或 Registry 镜像发布。上传前检查远端同名版本与文件，已有制品仅在哈希一致时复用，冲突停止，不覆盖旧版本。上传后回读核对文件与哈希。

本轮开发交付使用下列入口；先完成定向测试、提交当前源码，再构建和核验同一提交的产物。构建成功后推送对应分支，再上传软件包：

```bash
npm run package:managed
node scripts/run_python.mjs scripts/gitea_git.py push gitea HEAD:refs/heads/main
npm run publish:cloud
```

`publish:cloud` 不构建、不提交，也不执行 Git 推送。它要求干净源码及 Gitea 分支与本地 HEAD 一致，验证离线源码中的受跟踪文件、ARM64 镜像来源与校验文件，再以 `<应用版本>-dev.<提交前12位>` 创建不可覆盖的 Generic 开发构建版本。源码上传前必须确认软件包关联到私有 `hugo/cageledger` 并继承其权限。首次只用不含源码的固定 bootstrap 文件建立关联；关联失败停止。来源清单不含凭据，上传后的大小和 SHA256 从 Gitea 回读，续传记录位于仓库外的 `CageLedger-delivery-state/`。

该入口上传离线源码包、ARM64 离线镜像、加载说明、校验文件和构建来源清单，不移动现有 Release 或 `latest`。Registry 认证未就绪时不能把 Generic 镜像归档托管描述为可直接 `docker pull` 的镜像发布。

正式 Release 上传、Registry 镜像发布和 `latest` 更新分别使用相应受管入口，并验证 API 与 registry 的认证、地址和结果；网络密钥绑定 HTTPS API 主机不等于 Docker registry 已认证。Gitea 托管不触发生产 NAS 的自动部署。

`release:local` 作为 Mac mini 受管正式发布入口保留，仍有平台专用转换器信任和完整交付核验。当前云端 WebKit 系统库未齐，默认启动校验受限；只有补齐依赖并实际通过后才能报告完整三浏览器门禁。它不是云端普通构建前置步骤；未经完整适配和验证，不能宣称该正式发布管线已迁移到 Linux。已有版本、标签和制品保持不可覆盖；生产部署另行授权。恢复及证据规则见 [发布工程](release-engineering.md)。
