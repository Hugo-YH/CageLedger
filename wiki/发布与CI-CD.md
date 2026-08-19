# 发布与 CI-CD

正式发布由版本提交、tag、Gitea Release、容器镜像和 Wiki 同步组成。

## 发布顺序

```text
release notes
-> check
-> offline package
-> local multi-arch container publish
-> update latest multi-arch manifest
-> commit
-> v<version> tag
-> push main and tag
-> local upload to Gitea Release
-> local Gitea Wiki sync
```

版本号、提交、tag、Release、离线包和镜像保持一一对应。

Git tag 与容器镜像 tag 只带版本号：Git tag 使用 `v<version>`（例如 `v1.0.0-beta7`），容器镜像 tag 使用 `<version>`（例如 `1.0.0-beta7`）；`build` 不再进入软件包 tag。

容器镜像构建与推送是发布产物的固定组成部分。`--skip-container-publish` 只在交互式终端输入 `yes` 明确确认后才生效；非交互环境（脚本、CI、代理）不允许跳过，缺少 Docker 时发布流程直接失败并提示先启动 Docker。

## 版本与构建标识

- 版本格式 `a.b.c[-betaN | -rcN]`：`a` 重大/代际版本，`b` 功能更新，`c` 补丁修复，`-betaN` 内测后缀，`-rcN` 公测后缀。
- `build` 为纯数字构建号，从最早记录 `0.2.0（Build 1）` 起按发布顺序逐次递增，带后缀的小版本（如 `0.5.16a`、`0.5.16b`）各占一个 build；系统统一显示为 `a.b.c（Build N）`。
- 版本唯一源 `package.json`（含 `build` 字段）；发布脚本从更新记录推导下一个 build 并写入 `package.json`，`/api/health` 与 `/api/system/info` 返回 `build` 与 `revisionShort`。
- 未显式指定版本时，发布脚本按 `--bump`（支持 `beta|rc|patch|minor|major`，默认 `beta`）从最近 `v*` tag 自动推导下一个版本，并自动打标签与推送。
- `--bump patch` 从 `-betaN` / `-rcN` 预发布转正式时保留 `a.b.c` 并去掉后缀；正式版从 `main` 发布，并要求当前 `main` 已包含 `origin/rc`。从正式版本继续补丁时 `a.b.c` 加一。
- 显示规则：支持括号的位置显示 `a.b.c（Build N）`（例如 `1.0.0-beta7（Build 135）`）；软件包 tag 只带版本号。

## 发布前准备

1. 拉取远端并处理本地改动；正式版先将已验证 `rc` 快进到 `main`。
2. 在 `wiki/更新日志.md` 增加独立版本记录和更新时间，再执行 `npm run release:notes:sync` 生成系统内更新记录。
3. 同步受影响的 `wiki/` 和 `docs/contracts/`。
4. 确认 `package.json` 中仍是发布前版本，版本脚本统一修改。

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
7. Mac mini 本地执行多架构镜像发布并导出离线镜像包
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
2. 从干净的 tag 或 HEAD worktree 构建 `amd64` 和 `arm64`
3. 推送 `ddns.cellnucle.us:3333/hugo/cageledger:X.Y.Z`
4. 将已验证的 `X.Y.Z` 多架构 manifest 同步为 `latest`
5. 导出 `dist/` 下的离线镜像 tar.gz

## 凭据

| 凭据                     | 类型              | 用途                                                               |
| ------------------------ | ----------------- | ------------------------------------------------------------------ |
| `CAGELEDGER_GITEA_TOKEN` | 本地环境变量      | 本地创建 Release、上传离线包和同步 Wiki；缺省时复用 Git HTTPS 凭据 |
| Git HTTPS 凭据文件       | `~/.git-cageledger-credentials`（权限 600） | 后台会话与代理执行 Git fetch/push；已配置 per-host `credential.http://ddns.cellnucle.us:3333.helper store --file=...` |
| 容器仓库凭据             | Mac mini 本地凭据 | 本地发布多架构容器镜像                                             |

Mac mini 是检查、验证、制品生成与上传的唯一执行端。Gitea 保存 Git 代码、Wiki、Release 离线包和容器镜像，不运行 CI、打包、镜像校验或 Wiki 同步任务。

后台会话（`launchctl managername` 返回 `Background`）无法读取 macOS 登录钥匙串（`-25308`），
因此代理或非交互终端执行发布前，确认 `~/.git-cageledger-credentials` 存在且权限为 600。
容器镜像发布依赖 Docker 运行时：`colima status` 未运行时报错时先执行 `colima start`。

## 本地发布门禁

发布脚本默认执行 `npm run verify:full`，覆盖基础质量检查、生产构建与完整 Playwright。Playwright 使用独立的 `5183/5184` 端口和临时 SQLite，不影响日常运行在 `5173/5174` 的服务。`--skip-full-verify` 用于同版本验证完成后的上传重试。Mac mini 继续执行 API 冒烟、PDF/打印验收和多架构镜像构建。

## 发布结果检查

- `git tag --list 'vX.Y.Z'` 存在新 tag，且正式 tag 的提交位于 `main`。
- Gitea Release 显示对应版本和离线包。
- `ddns.cellnucle.us:3333/hugo/cageledger:X.Y.Z` 可以拉取。
- `ddns.cellnucle.us:3333/hugo/cageledger:latest` 与最新正式版本具有相同的 `amd64`、`arm64` manifest。
- `/api/health` 返回对应版本和 revision。
- 系统更新检查识别最新 Release。
- `/docs/` 显示本次文档变更，Gitea Wiki 显示迁移入口。

## 版本修复规则

每次修复创建新版本和新 tag。旧 tag、旧 Release 和旧镜像保持不可变，便于追溯和回滚。

## 相关页面

- [[部署与运行]]
- [[开发规范]]
- [[故障排查]]
