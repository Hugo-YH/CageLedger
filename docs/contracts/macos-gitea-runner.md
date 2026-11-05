# 可选备用：Mac mini Gitea Runner ARM64 构建

生产设备为群晖 DS223，`uname -m` 为 `aarch64`，镜像目标固定为 `linux/arm64`。保留离线源码包、ARM64 镜像包、加载说明和 SHA256，不再生成或验收 AMD64 产物；历史版本不删除。

日常开发、测试和交付构建由 Codex 云端完成，代码及产物推送到 Gitea。Mac mini 仅作可选手动备用，无需为云端交付先安装 Runner。

备用 Mac mini 使用原生 macOS ARM64 Runner，标签为 `macos-arm64:host`。Docker Desktop／Colima 提供 Linux ARM64 构建环境。Gitea 接收代码、调度任务和托管产物；Runner 不安装到生产 NAS。

## 1. 准备 Mac mini

以下操作在 Apple Silicon Mac mini 终端执行；先确认 `uname -m` 输出 `arm64`。不在 Docker 容器中执行 Runner 安装。

```bash
brew install node@22 python@3.13 uv shellcheck
brew install --cask libreoffice
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH"
node --version
python3.13 --version
npx --yes --package npm@11.21.1 npm --version
git --version
docker info
docker buildx version
```

已有能正常工作的 Docker Desktop 或 Colima 时保持原配置。尚无 Docker 时可安装 Colima：

```bash
brew install colima docker docker-buildx
colima start --arch aarch64 --cpu 4 --memory 4 --disk 80
docker context use colima
docker info
docker buildx version
```

工作流用固定的 npm 11.21.1 安装锁文件依赖，不修改其他项目使用的全局 npm。

若 Homebrew 提示 Buildx 插件目录未配置，按 `brew info docker-buildx` 的说明添加插件路径，保留 Docker 配置中的其他字段。M4／16GB 一次只运行一个构建或受管重测试，不与其他重任务重叠。

## 2. 在 Gitea 开启 Actions

确认实例启用 Actions；需要时在服务配置中设置：

```ini
[actions]
ENABLED=true
```

在 `hugo/cageledger` 仓库设置中启用 Actions，并进入 Actions → Runners 创建仓库级注册令牌。它与 `CAGELEDGER_GITEA_TOKEN` 访问令牌不同；只在 Mac 注册提示中输入，不放进聊天、命令参数或仓库文件。

host Runner 的任务直接在 Mac 当前账号运行，因此只为本项目可信代码开放；示例工作流仅接受 `workflow_dispatch` 手动触发；代码推送不会自动运行 Mac 构建。

## 3. 安装并注册原生 Runner

先把包含本次变更的仓库检出同步到 Mac，再在仓库目录运行：

```bash
python3.13 scripts/setup_macos_runner.py
cd "$HOME/Library/Application Support/CageLedgerRunner"
./gitea-runner -c config.yaml register
```

安装器固定官方 Gitea Runner 5.3.0 的 darwin-arm64 二进制，并校验官方 SHA256；保留已有配置和注册信息，不自动注册或启动服务。注册时填写：

| 项目        | 内容                                                 |
| ----------- | ---------------------------------------------------- |
| Gitea 地址  | `https://git.cellnucle.us`，与当前实例 ROOT_URL 一致 |
| 注册令牌    | 仓库设置中新生成的 Runner 注册令牌                   |
| Runner 名称 | `mac-mini-arm64`                                     |
| 标签        | 配置已固定 `macos-arm64:host`                        |

注册后限制 `.runner` 文件权限，先在前台验证上线：

```bash
chmod 600 .runner
./gitea-runner -c config.yaml daemon
```

Gitea 页面应显示 Runner 在线。前台验证完成后按 Ctrl+C 结束这个进程，再安装后台服务，避免同一注册同时启动两个 daemon。

## 4. 登录后自动运行

安装器已生成用户级 LaunchAgent；执行：

```bash
plutil -lint "$HOME/Library/LaunchAgents/us.cellnucle.cageledger.runner.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/us.cellnucle.cageledger.runner.plist"
launchctl kickstart "gui/$(id -u)/us.cellnucle.cageledger.runner"
```

这是登录用户服务：该账号登录且 Docker 已启动后才能构建，不能据此声称机器重启后未登录也可无人值守运行。保留 Mac 的网络连接并避免任务期间休眠。日志位于 `~/Library/Application Support/CageLedgerRunner/logs/`。

## 5. 运行构建任务

仓库 `.gitea/workflows/macos-arm64.yml` 按 `macos-arm64` 标签调度，仅从 Actions 页面手动运行备用任务。任务执行类型／架构检查，再通过 `package:managed` 共用宿主锁、内存压力保护并串行构建开发产物。该入口先观察约 60 秒稳定资源状态，不要同时手动启动另一套重任务。输出为离线源码包、ARM64 镜像包及加载／SHA256 文件，上传到本次 Actions 的构建产物。

完整发布前仍按测试策略完成完整门禁。此工作流不会创建 Release、推送镜像、修改 latest 或部署 DS223；这些操作需要独立的发布流程和授权，不在 Actions 中直接重入会创建提交与标签的 `release:local --push`。

Runner 主机的 Docker 构建使用当前本地 Docker Desktop／Colima context；日常云端构建入口使用受管 Linux socket 和专用 builder。Mac 工作流不 source `cloud_env.sh`，避免套用云端 socket、仿真和清缓存配置。

## 内网传输与验证边界

Runner 注册使用 Gitea 配置的 ROOT_URL。若要避免产物经 frp 中转，应让 Mac 上的 `git.cellnucle.us` 通过内网 DNS 指向 Gitea 所在 NAS 的 HTTPS 反向代理，并保留有效域名证书。仅把 Runner 放进内网不会自动改变公网域名的网络路径；不要关闭 TLS 校验。

当前只有云端脚本和模拟测试可在本会话验证。Mac 的安装、注册、launchd、Docker context 和 Gitea 实际任务运行，须在上述 Mac mini 上完成后才能报告通过。

官方依据：[Runner 5.3.0 文档](https://gitea.com/gitea/runner/src/tag/v5.3.0/README.md)、[官方校验和](https://gitea.com/gitea/runner/releases/download/v5.3.0/checksums.txt)、[Runner 配置](https://gitea.com/gitea/runner/src/tag/v5.3.0/internal/pkg/config/config.example.yaml)。
