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

## 发布前准备

1. 拉取远端并处理本地改动。
2. 在 `src/react/releaseNotes.ts` 增加独立版本记录和更新时间。
3. 同步受影响的 `wiki/` 和 `docs/contracts/`。
4. 确认 `package.json` 中仍是发布前版本，版本脚本统一修改。

## 本地发布

```bash
npm run release:local -- --version X.Y.Z --push
```

脚本会执行：

1. `scripts/set_version.mjs`
2. 校验 `src/react/releaseNotes.ts`
3. `npm run verify:full`
4. `npm run package:offline`
5. Git commit
6. annotated tag
7. Mac mini 本地执行多架构镜像发布并导出离线镜像包
8. 推送 `main` 和新 tag
9. 创建或更新 Gitea Release，并上传本地生成的离线包
10. 将本地 `wiki/` 同步到 Gitea Wiki

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
3. 推送 `git.cellnucle.us/hugo/cageledger:vX.Y.Z`
4. 将已验证的 `vX.Y.Z` 多架构 manifest 同步为 `latest`
5. 导出 `dist/` 下的离线镜像 tar.gz

## 凭据

| 凭据                     | 类型              | 用途                                                               |
| ------------------------ | ----------------- | ------------------------------------------------------------------ |
| `CAGELEDGER_GITEA_TOKEN` | 本地环境变量      | 本地创建 Release、上传离线包和同步 Wiki；缺省时复用 Git HTTPS 凭据 |
| 容器仓库凭据             | Mac mini 本地凭据 | 本地发布多架构容器镜像                                             |

Mac mini 是检查、验证、制品生成与上传的唯一执行端。Gitea 保存 Git 代码、Wiki、Release 离线包和容器镜像，不运行 CI、打包、镜像校验或 Wiki 同步任务。

## 本地发布门禁

发布脚本默认执行 `npm run verify:full`，覆盖基础质量检查、生产构建与完整 Playwright。Playwright 使用独立的 `5183/5184` 端口和临时 SQLite，不影响日常运行在 `5173/5174` 的服务。`--skip-full-verify` 用于同版本验证完成后的上传重试。Mac mini 继续执行 API 冒烟、PDF/打印验收和多架构镜像构建。

## 发布结果检查

- `git tag --list 'vX.Y.Z'` 存在新 tag。
- Gitea Release 显示对应版本和离线包。
- `git.cellnucle.us/hugo/cageledger:X.Y.Z` 可以拉取。
- `git.cellnucle.us/hugo/cageledger:latest` 与最新正式版本具有相同的 `amd64`、`arm64` manifest。
- `/api/health` 返回对应版本和 revision。
- 系统更新检查识别最新 Release。
- Gitea Wiki 显示本次文档变更。

## 版本修复规则

每次修复创建新版本和新 tag。旧 tag、旧 Release 和旧镜像保持不可变，便于追溯和回滚。

## 相关页面

- [[部署与运行]]
- [[开发规范]]
- [[故障排查]]
