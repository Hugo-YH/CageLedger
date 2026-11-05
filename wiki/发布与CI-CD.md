# 发布与 CI-CD

Codex 云端负责日常开发、验收、按影响范围的测试和交付任务的软件包构建；代码及产物推送到 Gitea，由 Gitea 托管代码和软件包。Mac mini Runner 仅作可选手动备用。只有明确交付任务才在云端构建并上传；普通修改与代码推送不自动打包。测试证据、源码和产物对应同一最终状态及来源 revision，旧版本制品不覆盖，NAS 不自动部署。普通产物可用 Gitea 私有仓库的开发构建草稿附件托管，操作见 `docs/contracts/cloud-development.md`。备用 Runner 见 `docs/contracts/macos-gitea-runner.md`，仅手动触发。

下面保留 Mac mini 受管正式发布流程，仍有平台专用转换器信任校验；当前云端 WebKit 系统库也受限，不能宣称 Linux 完整正式发布管线已全部适配。这不是云端普通打包与开发包上传的前置入口。正式发布由版本提交、tag、Gitea Release、容器镜像和 Wiki 同步组成。

## 云端默认验证

按diff风险选择检查并复用有效结果 → 应用/文档一次共享构建 → 源码与ARM64包 → 新产物一次冒烟 → 推代码与私有开发草稿。Firefox/WebKit、完整Chromium、Writer/PDF仅在对应风险或显式全量要求时补充；不因提交、版本标签或调度并发改变而重复全测。上传首尾检查真实权限，新附件完整回读一次，续传复用完整SHA凭据；必要时显式 `--audit-remote`。

完整策略以仓库 `docs/contracts/testing-strategy.md` 为准，下面只描述可选的Mac完整正式发布配置。

## 发布顺序

```text
release notes
-> check
-> offline package
-> commit
-> v<version> tag
-> local ARM64 container publish
-> push main and tag
-> local upload to Gitea Release
-> local Gitea Wiki sync
-> delivery/offline verification
-> update latest ARM64 manifest
```

版本号、提交、tag、Release、离线包和镜像保持一一对应。

Git tag 与容器镜像 tag 只带版本号：Git tag 使用 `v<version>`（例如 `v1.0.0-beta7`），容器镜像 tag 使用 `<version>`（例如 `1.0.0-beta7`）；`build` 不再进入软件包 tag。

后续生产目标为 DS223（aarch64），仅构建离线源码包、ARM64 镜像及离线镜像包；历史 AMD64 制品不删除。受管正式发布不提供跳过必需产物的旁路；缺少 Docker 时明确失败，不将不完整构建报告为成功。

## 版本与构建标识

- 版本格式 `a.b.c[-betaN | -rcN]`：`a` 重大/代际版本，`b` 功能更新，`c` 补丁修复，`-betaN` 内测后缀，`-rcN` 公测后缀。
- `build` 为纯数字构建号，从最早记录 `0.2.0（Build 1）` 起按发布顺序逐次递增，带后缀的小版本（如 `0.5.16a`、`0.5.16b`）各占一个 build；系统统一显示为 `a.b.c（Build N）`。
- 版本唯一源 `package.json`（含 `build` 字段）；发布脚本从更新记录推导下一个 build 并写入 `package.json`，`/api/health` 与 `/api/system/info` 返回 `build` 与 `revisionShort`。
- 未显式指定版本时，发布脚本按 `--bump`（支持 `beta|rc|patch|minor|major`，默认 `beta`）从最近 `v*` tag 自动推导下一个版本，并自动打标签；指定 `--push` 才执行镜像发布、Git 推送、Release 上传和 Wiki 同步。
- `--bump patch` 从 `-betaN` / `-rcN` 预发布转正式时保留 `a.b.c` 并去掉后缀；正式版从 `main` 发布，并要求当前 `main` 已包含 `origin/rc`。从正式版本继续补丁时 `a.b.c` 加一。
- 显示规则：支持括号的位置显示 `a.b.c（Build N）`（例如 `1.0.0-beta7（Build 135）`）；软件包 tag 只带版本号。

## 发布前准备

1. 拉取远端并处理本地改动；正式版先将已验证 `rc` 快进到 `main`。
2. 在 `wiki/更新日志.md` 增加独立版本记录和更新时间。标题不要预写 build 号：脚本按当前最大 build 自动 +1；若标题已带 build 号则原样复用，保证中断后重跑幂等。再执行 `npm run release:notes:sync` 生成系统内更新记录。
3. 涉及 UI 文案或导航结构变更时，同步检索并更新 e2e 断言（`rg '旧文案' tests/e2e`）。导航项优先使用稳定 `data-ui` 标识（例如 `nav-billing-monthly-summary`），避免文案改名触发 Playwright 失败。
4. 同步受影响的 `wiki/` 和 `docs/contracts/`。
5. 确认 `package.json` 中仍是发布前版本，版本脚本统一修改。
6. 后台会话执行前确认 Git 凭据可用：`~/.git-cageledger-credentials`（权限 600）或 `CAGELEDGER_GITEA_TOKEN`。docker daemon 未运行时脚本会自动执行 `colima start`。

## 本地发布

```bash
npm run release:local -- --version X.Y.Z --push
```

脚本会执行：

1. `scripts/set_version.mjs`
2. 从 `wiki/更新日志.md` 生成并校验系统内更新记录
3. `npm run verify:full`
4. `npm run package:offline`
5. Git commit
6. annotated tag
7. Mac mini 本地执行 ARM64 镜像发布并导出离线镜像包
8. 推送 `main` 和新 tag
9. 创建或更新 Gitea Release，并上传本地生成的离线包
10. 将 Gitea Wiki 同步为 VitePress 文档迁移入口

本地演练：

```bash
npm run release:local -- --version X.Y.Z --dry-run
```

如需只发布容器镜像：

```bash
npm run publish:container:local -- --version X.Y.Z --export-offline-images
```

这条命令会：

1. 同步 `cageledger-base` 的多架构 tag
2. 从干净的 tag 或 HEAD worktree 构建 `linux/arm64`
3. 推送 `ddns.cellnucle.us:3333/hugo/cageledger:X.Y.Z`
4. 将已验证的 `X.Y.Z` ARM64 manifest 同步为 `latest`
5. 导出 `dist/` 下的离线镜像 tar.gz

构建器使用 BuildKit 缓存 npm、pip 和系统包下载；系统包与 Python 缓存按目标架构隔离。版本号或依赖变化导致安装步骤重新执行时，可复用已下载的包；缓存不进入发布镜像，清理构建器缓存或更换构建器后需要重新下载。系统包安装仍执行 `apt-get update`，基础镜像更新和依赖更新仍可能下载新版本。

可在独立受管终端运行 `npm run prewarm:container:local` 预热依赖阶段；该命令不会生成或推送发布镜像。与测试并行时按测试策略监测资源；构建器空间不足可能回收缓存，使正式构建仍需下载。预热不会替代任何发布检查，目前不自动接入发布脚本。

## 凭据

| 凭据                     | 类型                                        | 用途                                                                                                                  |
| ------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `CAGELEDGER_GITEA_TOKEN` | 本地环境变量                                | 本地创建 Release、上传离线包和同步 Wiki；缺省时复用 Git HTTPS 凭据                                                    |
| Git HTTPS 凭据文件       | `~/.git-cageledger-credentials`（权限 600） | 后台会话与代理执行 Git fetch/push；已配置 per-host `credential.http://ddns.cellnucle.us:3333.helper store --file=...` |
| 容器仓库凭据             | Mac mini 本地凭据                           | 本地发布 ARM64 容器镜像                                                                                               |

Codex 云端负责日常开发、验收、按影响范围的测试和交付任务的软件包构建；代码及产物推送到 Gitea，由 Gitea 托管代码和软件包。Mac mini Runner 仅作可选手动备用。云端网络密钥通过 HTTPS 主机限定注入，使用仓库 Git 包装器；不复制到本地凭据文件。

表中 HTTP credential store、macOS 钥匙串和 Colima 仅属于原 Mac mini 发布兼容环境，不作为云端要求。镜像仓库认证独立配置，不能把 API 网络密钥当作 Docker 原始密码。

## 本地发布门禁

发布脚本默认执行 `npm run verify:full`，覆盖基础质量检查、生产构建、Chromium 完整回归和 Firefox／WebKit 桌面兼容专项。Chromium 使用独立的 `5183/5184` 端口和临时 SQLite，桌面兼容专项使用另外两组独立端口，详见 `docs/contracts/testing-strategy.md`。Mac mini 继续执行 API 冒烟、PDF/打印验收和ARM64 镜像构建。

受管入口按输入指纹复用完整且有效的成功证据，不提供跳过门禁的旁路。失败、运行时改变或远端结果不明时按状态目录续接和核对，不覆盖已有标签或制品。

## 上传中断后的续传

Git 分支与 tag 已推送、镜像已发布，只有 Release 附件上传或 Wiki 同步失败时，在 Mac mini 使用对应的独立脚本续传。先核对当前检出提交与 `vX.Y.Z` 指向同一提交、`package.json` 的版本和 build 与该 tag 一致，并保留原发布生成的离线包；不要删除或移动已有 tag，也不要重新生成该版本制品。

下面的命令只执行尚未完成的步骤，`X.Y.Z` 替换为目标版本：

```bash
bash scripts/upload_release_package_local.sh --version X.Y.Z --package "$PWD/dist/CageLedger-offline-X.Y.Z.tar.gz"
bash scripts/sync_wiki_local.sh
```

上传脚本会复用同版本 Release 与已有同名附件，补传缺失附件并完成发布；完成后按下方“发布结果检查”核对附件与发布时间。若中断发生在镜像发布或 Git 推送阶段，先根据已完成步骤补齐对应产物及分支、tag 推送，再续传 Release 和 Wiki。

## 常见失败与处理

| 现象                                         | 原因                              | 处理                                                                                              |
| -------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Git 报 `-25308` 或 `could not read Username` | 后台会话无法读取 macOS 登录钥匙串 | 配置 `~/.git-cageledger-credentials`（权限 600）或 `CAGELEDGER_GITEA_TOKEN`，脚本会给出诊断并退出 |
| `docker daemon 未运行`                       | colima / Docker Desktop 未启动    | 脚本自动执行 `colima start`；失败时手动 `colima status` 与 `colima start` 后重试                  |
| build 号跳号或重复                           | 更新日志标题预写了 build 号       | 脚本会复用标题已有 build 号；不要在发布前手写 build 号                                            |
| Playwright 找不到菜单或按钮                  | UI 文案与 e2e 断言不同步          | 导航项改用 `data-ui` 稳定标识；其余文案同步更新断言后重跑                                         |

## 发布结果检查

- `git tag --list 'vX.Y.Z'` 存在新 tag，且正式 tag 的提交位于 `main`。
- Gitea Release 显示对应版本和离线包。
- `ddns.cellnucle.us:3333/hugo/cageledger:X.Y.Z` 可以拉取。
- `ddns.cellnucle.us:3333/hugo/cageledger:latest` 与最新正式版本具有相同的 `linux/arm64` manifest。
- `/api/health` 返回对应版本和 revision。
- 系统更新检查识别最新 Release。
- `/docs/` 显示本次文档变更，Gitea Wiki 显示迁移入口。

## 版本修复规则

每次修复创建新版本和新 tag。旧 tag、旧 Release 和旧镜像保持不可变，便于追溯和回滚。

## 相关页面

- [[部署与运行]]
- [[开发规范]]
- [[故障排查]]
