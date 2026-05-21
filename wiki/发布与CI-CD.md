# 发布与 CI-CD

本页描述当前正式发布链和 Gitea 工作流分工。

## 发布链

```text
commit
→ version
→ tag
→ Gitea Release
→ Gitea Container Registry
→ Wiki Sync
```

版本号、tag、Release 和镜像要求一一对应。

## 本地发布命令

```bash
npm run release:local -- --version X.Y.Z --push
```

发布前更新：

- `src/app.js` 中的 `SYSTEM_RELEASE_NOTES`
- 需要同步的 `wiki/` 页面

## 发布前检查

```bash
npm run check
npm run smoke:api
npm run package:offline
```

## 工作流分工

| 工作流 | 作用 |
| --- | --- |
| `.gitea/workflows/release-package.yml` | 创建 Release、上传离线包 |
| `.gitea/workflows/publish-container.yml` | 构建并推送容器镜像 |
| `.gitea/workflows/sync-wiki.yml` | 同步 `wiki/` 到 Gitea Wiki |

## 凭据分工

| 凭据 | 用途 |
| --- | --- |
| `GITEA_TOKEN` | 创建 Release、同步 Wiki |
| `PACKAGE_USERNAME` | 镜像仓库登录用户名 |
| `PACKAGE_PAT` | 镜像仓库登录令牌 |

## 正式发布口径

- 用户侧“系统更新”按 Gitea 最新 Release 判断
- `main` 上的普通提交不会直接成为可安装更新
- 正式镜像地址固定为 `git.cellnucle.us/hugo/cageledger:<tag>`

## 常见发布动作

### 拉取远端最新代码

```bash
git pull --ff-only origin main
```

### 发布新版本

```bash
npm run release:local -- --version 0.5.3 --push
```

### 只做本地校验

```bash
npm run release:local -- --version 0.5.3 --dry-run
```

## 相关页面

- [[部署与运行]]
- [[开发规范]]
- [[常见问题]]
