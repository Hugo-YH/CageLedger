# Codex 云端开发、构建与 Gitea 交付

Codex 云端负责日常开发、验收、按影响范围的测试和交付任务的软件包构建；代码及产物推送到 Gitea，由 Gitea 托管代码和软件包。Mac mini Runner 仅作可选手动备用，见 [备用配置](macos-gitea-runner.md)。生产目标为群晖 DS223（aarch64），云端后续只交付ARM64 Packages镜像与离线镜像包；离线源码包以后由Gitea本地构建，Codex不再上传，Gitea本地构建另行配置；历史AMD64制品保留。构建、提交、推送、上传、发布环境与生产部署分别按任务授权执行。

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

Linux 的受管检查使用 cgroup v2 有限内存配额、OOM 事件及 swap 监测，保留互斥锁、单 worker、独立数据库和进程清理。定向单元/API 测试只做一次准入；完整和浏览器检查保留稳定观察。日常与交付都按风险选范围；`check`、`verify:full` 仅在明确选择完整范围时执行；所有所需依赖和用例必须实际完成，不能将 dry-run 或单元测试通过描述为浏览器验收。

## 云端受管构建

运行依赖固定在 `runtime-image.lock.json`：包含基础镜像、冻结 Python 依赖和构建片段的指纹，以及 ARM64 运行环境的不可变 OCI 摘要。受管应用构建从这个固定运行环境继续构建，跳过 apt/pip 安装；本地缓存经 SHA256 校验，缺失内容才从 Gitea 以固定小缓冲流式下载；服务支持 Range 时续传，不支持时核对已有前缀并顺序读取完整响应。即使 BuildKit 缓存丢失，也不会静默重新解析一套不同依赖。`requirements-runtime.txt` 固定生产 Python 直接与传递依赖，`requirements.txt` 保留开发约束；修改任一依赖输入都需要显式刷新运行环境。

仅在首次初始化或依赖/安全更新时执行：

```bash
npm run runtime:refresh
# 明确需要重新获取系统软件更新时：
npm run runtime:refresh -- --rebuild
```

刷新入口使用宿主锁和资源保护，验证 Linux ARM64、依赖指纹、全部 OCI 摘要及远端 blob，再发布 `runtime-<内容摘要前16位>-arm64`，最后更新待提交的锁文件；不移动应用版本和 `latest`。失败保留仓库外的构建与上传状态，按同一意图恢复。运行环境镜像和应用镜像共享 Gitea 已存在的同摘要层，不重复上传这些字节；页面显示的完整镜像大小不等于单次增量流量。首次冷缓存仍需要完整下载运行环境。

只有明确要求构建或交付的任务才执行打包；普通开发修改、提交或代码推送仍只做按影响范围的测试，不自动升级为全量或软件包构建。云端执行：

```bash
python scripts/setup_cloud_builder.py
export CAGELEDGER_BUILDX_BUILDER=cageledger-cloud
npm run package:managed
```

`package:managed` 共用宿主锁和资源保护，先执行可复用的 `build:shared`，再串行执行 `package:offline` 与 `package:container`。源码包复用已验证的应用/文档输出，生成 `dist/CageLedger-offline-<version>.tar.gz`；镜像也通过受验证的命名上下文复用同一 `web-dist`，只构建 ARM64 运行时，直接导出 `docker load` 兼容镜像包、加载说明和 SHA256，校验通过后才替换最终产物。打包入口本身不上传，不与受管浏览器或其他重任务重叠。交付时复用同一最终源码状态的有效测试证据，记录确切来源 revision；构建后出现新修改须重新判断测试与产物是否失效，不能将脏工作区产物仅标记成旧 HEAD 的干净构建。

Docker/Buildx 必须具有 ARM64 构建能力，能力不足明确失败。当前云端 rootless Docker 的默认 builder 不能据 binfmt 注册成功就判定可构建 ARM64。初始化命令使用固定摘要的官方 BuildKit、现有代理和 CA，创建独立 `cageledger-cloud` builder，每次实际运行 ARM64 指令探针；不切换全局 Docker context、不修改宿主 binfmt，也不重启未知 daemon。

`cloud_env.sh` 默认保留可复用依赖缓存，并以 `CAGELEDGER_BUILD_CACHE_LIMIT=12GB` 在导出后对专用 builder 执行有界GC；不再每次全清并重新安装依赖。确需完全清理时显式设置 `CAGELEDGER_BUILD_PRUNE=1`。任何自动清理仍拒绝默认或未知 builder。环境恢复后必要时重新初始化；BuildKit ARM64 构建成功不等同于宿主 Docker 可以直接运行 ARM64 容器。

可选的 Mac mini 备用构建仅手动触发，使用原生 ARM64 Docker Desktop／Colima context，保留缓存，不套用云端激活脚本和 builder 配置。

Docker 网络构建保持代理与 TLS 验证，使用 BuildKit secret 临时挂载所需 CA；会话证书和凭据不得进入最终镜像。Git/API 站点由 `CAGELEDGER_GITEA_URL` 选择，镜像仓库独立由现有 registry 配置选择，不能用改 Git URL 的方式更改镜像流量路径。

## Gitea 托管与发布边界

日常交付以 Gitea Packages 的 ARM64 镜像为准，NAS 保留本地 Docker 层并正常增量拉取。离线镜像整包改为按需上传；离线源码包不由 Codex 上传，Gitea 本地源码包构建另行配置。已有 Release、自动源码入口、历史架构与制品保持原样。

冻结发布源码与版本、完成相关测试及新产物一次冒烟后，推送分支和不可变附注标签，再按下列顺序交付（将 X.Y.Z 替换为实际版本）：

```bash
npm run publish:registry -- --archive dist/CageLedger-image-X.Y.Z-arm64.tar.gz --state-dir ../CageLedger-registry-state/X.Y.Z
npm run release:cloud -- --publish
npm run publish:registry -- --archive dist/CageLedger-image-X.Y.Z-arm64.tar.gz --state-dir ../CageLedger-registry-state/X.Y.Z --update-latest
```

`release:cloud` 默认只附小型来源/Registry 摘要 JSON、`PULL.txt` 和下载权限探针。创建和发表前均核验同版本已成功的 Packages 凭据及实时 ARM64 manifest、索引、config 和 blob 身份；不重新下载整层。凭据默认在仓库外 `CageLedger-registry-state/<版本>`，可用 `--registry-state-dir` 显式选择。无匹配凭据或远端摘要冲突时停止，不能凭“准备推送”发布空壳 Release。正式 Release 完成后才能显式更新 `latest`，它只包含 ARM64。

明确需要离线交付时使用：

```bash
npm run release:cloud -- --offline-image --publish
```

此时额外附 ARM64 离线镜像分片、加载说明、SHA256、来源清单和下载重组脚本；不附离线源码包。默认轻量模式和离线模式使用不同的 v2 receipt 身份，不接管旧模式或未知 Release，不给已发布版本追加附件。遗留 `--image-only` 只作兼容，不能代替显式 `--offline-image`，也不能重新启用源码上传。

仅需开发构建的离线附件时，可显式运行 `npm run publish:cloud -- --offline-image`。它要求干净源码、Gitea 分支与 HEAD 一致、归档及来源校验通过，创建所有权明确的 `v<应用版本>-dev.<提交前12位>` 私有草稿，不发布、不移动 `latest`。未指定开关时直接拒绝并指向 Packages 入口，避免日常无意上传大整包。

离线大文件沿用实测可用的不超过 8 MiB 分片（16 MiB 请求曾认证失败，Gitea 单附件上限 100 MiB），每个新附件完整回读 SHA256 一次；身份与完整哈希凭据不变时续传复用，`--audit-remote` 才重读全部附件。分片不能单独解压，附件中的标准库脚本按来源清单重组并校验原始 tar.gz。上传响应的 UUID 地址规范化为同一 Release 的下载地址后才做首次字节校验，避免同一文件的两个地址形式触发重复传输。

私有 Release 在首尾用小探针验证真实匿名下载权限；匿名 API 元数据返回 401 不能代替原始文件权限。Gitea Generic Packages 与私有仓库关联不保证原始下载私有，本环境已实际验证，不使用它承载私有源码。上传状态、所有权随机值及临时 Registry 会话保留在仓库外，不进代码和镜像；失败核对状态后续跑，不重复创建或覆盖。

Git/API 的 `CAGELEDGER_GITEA_TOKEN` 是代理注入绑定，不能在进程里编码成 Basic 密码。Registry 使用绑定 `git.cellnucle.us` 的 `CAGELEDGER_GITEA_REGISTRY_BASIC`，值为用户本地生成的 Base64(`hugo:具有写软件包权限的Token`)，不带 `Basic` 前缀及空格；仅向 HTTPS `/v2/token` 发送 Basic，得到的 Bearer 只驻留内存。不要打印、落盘或重新编码占位符。可选 Mac 构建通过锁定摘要和原有 Docker 凭据取同一运行环境，保持 Docker context、TLS 与认证配置。

软件版本发布、环境配置发布和生产 NAS 部署分别授权；本流程不自动部署 NAS。生产使用的 `ddns.cellnucle.us:3333` 与云端 API 的 HTTPS 地址是独立入口，内网下载是否经过 FRP 需按实际 DNS、认证 realm 和 blob 地址核对，不能仅凭 Packages 页面域名判断。

`release:local` 作为 Mac mini 受管正式发布入口保留，仍有平台专用转换器信任和完整交付核验。当前云端 WebKit 系统库未齐，默认启动校验受限；只有补齐依赖并实际通过后才能报告完整三浏览器门禁。它不是云端普通构建前置步骤；未经完整适配和验证，不能宣称该正式发布管线已迁移到 Linux。已有版本、标签和制品保持不可覆盖；生产部署另行授权。恢复及证据规则见 [发布工程](release-engineering.md)。
