# 发布与 CI-CD

正式发布由版本提交、tag、Gitea Release、容器镜像和 Wiki 同步组成。

## 发布顺序

```text
release notes
-> check
-> offline package
-> local multi-arch container publish
-> commit
-> v<version> tag
-> push main and tag
-> Gitea Release / Container Registry / Wiki Sync
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
3. `npm run check`
4. `npm run package:offline`
5. Git commit
6. annotated tag
7. Mac mini 本地执行多架构镜像发布并导出离线镜像包
8. 推送 `main` 和新 tag

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
4. 导出 `dist/` 下的离线镜像 tar.gz

完整浏览器回归在发布前单独执行：

```bash
npm run test:e2e
npm run smoke:api
```

## Gitea 工作流

| 工作流                                   | 作用                              |
| ---------------------------------------- | --------------------------------- |
| `.gitea/workflows/ci.yml`                | PR 和 main 的质量、测试、构建门禁 |
| `.gitea/workflows/release-package.yml`   | 创建 Release、上传离线包          |
| `.gitea/workflows/publish-container.yml` | 校验本地已发布的多架构容器镜像    |
| `.gitea/workflows/sync-wiki.yml`         | 将 `wiki/` 同步到 Gitea Wiki      |

## 凭据

| 凭据               | 类型     | 用途                    |
| ------------------ | -------- | ----------------------- |
| `GITEA_TOKEN`      | Secret   | 创建 Release、同步 Wiki |
| `PACKAGE_USERNAME` | Variable | 容器仓库用户名          |
| `PACKAGE_PAT`      | Secret   | 容器仓库令牌            |

Mac mini 本地发布是容器镜像的权威出口。Gitea 工作流负责校验 tag 对应镜像已经入库，并验证统一 tag 包含 `amd64` 与 `arm64`。

## 持续集成门禁

`ci.yml` 包含三个 job：

1. Frontend and documentation quality：Prettier、ESLint、Stylelint、Markdownlint、ShellCheck、TypeScript、Vitest 和生产构建。
2. Python quality：Ruff、unittest 和 py_compile。
3. Browser regression：完整 Playwright 和 axe serious/critical 扫描。

浏览器回归依赖前两个 job 成功。失败时上传 `playwright-report/` 和 `test-results/`，保留 14 天。

## 发布结果检查

- `git tag --list 'vX.Y.Z'` 存在新 tag。
- Gitea Release 显示对应版本和离线包。
- `git.cellnucle.us/hugo/cageledger:X.Y.Z` 可以拉取。
- `/api/health` 返回对应版本和 revision。
- 系统更新检查识别最新 Release。
- Gitea Wiki 显示本次文档变更。

## 版本修复规则

每次修复创建新版本和新 tag。旧 tag、旧 Release 和旧镜像保持不可变，便于追溯和回滚。

## 相关页面

- [[部署与运行]]
- [[开发规范]]
- [[故障排查]]
