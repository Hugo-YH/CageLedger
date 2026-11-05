# 发布工程

Codex 云端负责日常开发、验收、按影响范围的测试和交付任务的软件包构建；代码及产物推送到 Gitea，由 Gitea 托管代码和软件包。Mac mini Runner 仅作可选手动备用。新产物仅包含离线源码包和 `linux/arm64` 镜像／离线镜像包；历史 AMD64 版本保持不变。备用 Runner 见 [macos-gitea-runner.md](macos-gitea-runner.md)，只接受手动任务。云端本地打包、授权上传和生产部署分开处理，操作见 [cloud-development.md](cloud-development.md)。本文的 `release:local` 保留原 Mac mini 受管发布流程及其平台专用校验。发布不会操作生产服务、原始数据库或附件；生产部署需要单独授权。测试范围与资源预算以 [测试策略](testing-strategy.md) 为准。

## 普通构建交付与正式发布

普通修改按影响范围验证；只有明确交付任务才在云端构建并向 Gitea 上传软件包。测试证据、构建源码与产物必须对应同一最终状态和来源 revision。普通开发产物可使用 Gitea 私有仓库的开发构建草稿附件，附来源清单、源码包、ARM64 镜像包及 SHA256；同名远端文件仅在哈希一致时复用，冲突停止，不覆盖历史制品，不自动部署 NAS。

下文的完整 `release:local` 管线保留 Mac 平台转换器信任校验；当前云端 WebKit 系统库受限，Linux 完整正式发布管线尚不能宣称已全部适配。开发包上传不能替代正式 Release 所需门禁、版本与标签核对。

## 先诊断，再发布

```bash
npm run release:doctor
npm run release:doctor -- --online
npm run release:local -- --version X.Y.Z --push --dry-run
npm run release:local -- --version X.Y.Z --push
```

从隔离发布检出运行时，可加 `--source-checkout /absolute/development/CageLedger`。入口只读记录该开发目录的 `.env` 和 `data/` 指纹，续跑继续使用原基线；发布后比对文件，并仅对干净且分支一致的源检出做快进同步。脏目录保留并在汇总说明，不覆盖改动。正式 `main` 发布同时快进远端 `beta`，分叉时停止收尾，不强推。

`doctor` 汇总 Node、Python、Git 身份、隔离检出、内存压力、锁定版本浏览器、Docker 和转换器的就绪状态。`--online` 额外只读检查 Git 远端与 Gitea API 仓库权限，不上传制品。它不是测试通过证明，也不能提前保证 Registry 写权限或未来网络可用。正式入口仍校验分支、版本占用、完整门禁和发布后的制品。

云端默认顺序：冻结源码与版本 → 复用有效检查并补受影响范围 → 应用/文档共享构建一次 → 源码包与ARM64镜像 → 新产物一次冒烟 → 推代码 → 私有开发草稿上传及每个新附件一次完整回读。兼容引擎、Writer/PDF和完整回归由改动风险或显式要求触发。上传权限/草稿身份只在首尾复核，可信续传不重复下载已验证字节；显式 `--audit-remote` 保留全面存储审计。

下方 Mac 完整正式发布配置仍使用：环境预检 → 版本和更新记录 → 转换器 → 基础检查 → 一次应用/文档构建 → 完整浏览器门禁 → 源码包 → 提交/标签及交付。基础check不再单独构建文档，打包继续复用有效build凭据；浏览器目录与成功结果复用不受调度上限改变影响。它不是云端默认测试范围。

## 签名与认证

**默认不签名。** 发布提交显式使用 `--no-gpg-sign`，标签显式使用附注标签 `-a` 并关闭该命令的自动签名；即使本机配置了 `commit.gpgsign=true`、`tag.gpgsign=true`，普通发布也不会访问签名密钥。不修改个人 Git 配置。

需要签名时明确选择：

```bash
npm run release:doctor -- --sign --online
npm run release:local -- --version X.Y.Z --push --sign
```

签名模式在临时 Git 仓库实际签署并验证提交、标签，提前发现密钥、allowed signers 和信任配置问题；发布时再次验证实际提交和标签。仅尝试恢复当前配置的 SSH identity 和登录用户的有效 agent，过程有超时，不创建密钥、不修改钥匙串策略、不打印凭据。失败停止，不自动改为无签名。

状态文件记录 `signed` / `unsigned`。创建提交意图或冻结发布输入后，续跑必须沿用原策略；历史状态文件若已进入提交阶段，按旧版签名策略处理，续跑加 `--sign`。冻结前可以调整策略，匹配的测试证据仍按原规则复用。

三种检查分别处理：

| 项目                       | 用途                                  | 默认发布是否需要                             |
| -------------------------- | ------------------------------------- | -------------------------------------------- |
| Git 提交/标签签名          | 证明提交者和标签发布者身份            | 可选，显式 `--sign`                          |
| Git、Gitea、Registry 认证  | 获取代码、推送和上传制品的权限        | 需要；不因关闭签名而取消                     |
| LibreOffice 应用签名与公证 | 核实测试转换器完整性与 macOS 可执行性 | 需要；使用供应商签名，不要求开发者自行签应用 |

Git 传输优先使用当前有效 SSH agent，失效时只发现登录用户已有的 launchd / GUI agent；普通无签名发布不加载签名密钥。Gitea API、Release 上传和 Wiki 使用同一个凭据解析结果，按以下顺序选择：`CAGELEDGER_GITEA_TOKEN`、`CAGELEDGER_GITEA_TOKEN_FILE`、官方 HTTP 站点的 Git credential helper、Docker 配置中精确匹配 `ddns.cellnucle.us:3333` 的已有认证。token 文件须由当前用户拥有、权限为 600；显式文件错误不回退。凭据只传给发布子进程，不写入报告或隔离业务测试环境。Registry 继续使用 Docker 自己的认证；doctor 分别报告 Git、API 与 Registry 读取结果，只读预检不能保证之后写入一定成功。

## 开发目录中的测试工具

`CAGELEDGER_LIBREOFFICE_BIN` 显式路径优先，其次 `/Applications/LibreOffice.app`，再使用开发目录 `.codex-run/release-tools/` 的缓存。显式路径错误不会悄悄换工具。

缓存安装包保留在开发目录，不纳入 Git、离线包、架构扫描或 lint；转换器自带标准库不属于项目源码。每个 `libreoffice-*.json` 记录：

```json
{
  "version": "26.8.2",
  "image": "/absolute/development/release-tools/LibreOffice.dmg",
  "sha256": "填写从可信发布源核对的64位SHA256",
  "mount": "/absolute/development/release-tools/mounted-libreoffice"
}
```

缓存镜像和挂载点必须位于该工具目录内。入口核对镜像哈希，以只读方式挂载；正式发布继续检查完整应用签名、公证、版本以及实际 Writer → PDF 冒烟，不关闭安全检查。复用已挂载的同一镜像，不卸载操作者已有挂载；本次入口创建的挂载在退出时尝试卸载，失败明确报告保留路径，不强制卸载。不会自动下载或安装系统应用。

隔离发布检出可通过 `CAGELEDGER_RELEASE_TOOLS_DIR` 指向原开发目录的工具缓存。保持相同路径与版本有利于续跑；工具变化会使运行时凭据失效。浏览器从当前 Playwright 安装解析准确版本，覆盖 Chromium、headless shell、Firefox、WebKit 和 ffmpeg，不把历史缓存版本混入指纹。

受管发布和浏览器检查还将后端 PDF 渲染绑定到当前 Node Playwright 的 Chromium，通过隔离环境注入 `CAGELEDGER_CHROMIUM_BIN`；路径和浏览器内容纳入运行时指纹及嵌套打包核验。系统 Chrome 不参与受管测试，正常开发和生产容器仍沿用自己的配置。

## 进度与恢复

每个阶段显示开始、结束、耗时和日志路径；子进程运行期间约每 30 秒报告日志大小及最近输出时间。不会把可能含内部信息的子进程日志直接倾倒到终端。长时间没有新增输出不单独判失败；仍受资源保护和每阶段 60 分钟上限控制。

```bash
npm run release:status -- --state-dir /absolute/path/to/release-state/X.Y.Z
npm run release:local -- --version X.Y.Z --push --state-dir /absolute/path/to/release-state/X.Y.Z
```

`status` 只读状态文件；`running` 是日志记录，不保证对应进程仍存活。默认状态在仓库同级 `<仓库名>-release-state/<版本>/`，不可放进检出或打包目录。保持原检出、版本和状态目录续跑，不为了重试另开发布任务。原来使用 `--sign` 的续跑命令同样加 `--sign`。

- 本地失败：先修复原因，保留成功且仍匹配的阶段，重跑失败/失效部分。
- 资源保护停止：等待主机恢复，先查看已有任务，不盲目重启整套测试或增加超时、并发。
- 发布阶段 `unknown`：先核对远端。部分镜像、草稿、附件或冲突引用不得自动覆盖、重新 POST 或删除。
- 只有远端提交、标签、Release 正文与附件哈希、镜像、Wiki 和隔离冒烟均验证完成，才报告交付成功。生产部署状态另行说明。

受管镜像上传按架构先构建并加载本地镜像，核对平台、版本和来源提交，在 `image-publication/image-publication.json` 落盘 config digest 后才 push。config digest 从同次构建的临时 OCI 导出读取，并与 Buildx 元数据和加载身份交叉核对；不把 Docker inspect 的 ID 一律当作 config digest。身份落盘后删除额外 OCI tar，保留小型凭据。恢复时逐项核对远端 config digest；已一致的架构不重建、不重推，只继续缺失部分。版本索引仅包含 `linux/arm64`，并核对该架构的构建身份。恢复状态必须匹配当前 ARM64 目标，不能复用旧双架构上传凭据。远端已有但没有预 push 凭据、摘要冲突、未知网络响应、待推送本地镜像已变更/丢失或历史旧上传状态继续停止，不收养、不覆盖。离线镜像导出可以重新执行，不改变远端标签；`latest` 仍在完整交付核验后更新。手工 `publish:container:local` 入口保持独立，正式续传使用受管入口。

每个受管子进程保存 `*-cleanup.json`，按 PID 和启动时间记录拥有的进程及退出核对，不按名称结束其他 Chrome。成功、失败或中断均生成 `release-summary.json`，包含阶段、资源采样、进程/临时容器退出、转换器挂载、可选原件比对和同步结果。收尾失败保留已发布事实并标记 `finalization_incomplete`；不能只凭制品已上传就声称整轮收尾成功。没有指定源检出时，汇总不声明已核对开发目录原件。
