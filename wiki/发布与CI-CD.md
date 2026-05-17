# 发布与 CI/CD

## 当前发布链

```text
commit
→ version
→ tag
→ Gitea Release
→ Gitea Container Registry
```

四者要求严格一一对应。

## 本地发布

```bash
npm run release:local -- --version X.Y.Z --push
```

发布前先更新 `src/app.js` 中的 `SYSTEM_RELEASE_NOTES`。

## Gitea Actions 分工

| 工作流 | 作用 |
| --- | --- |
| `release-package.yml` | 创建 Release、上传离线包 |
| `publish-container.yml` | 构建并推送容器镜像 |
| `sync-wiki.yml` | 同步 `wiki/` 到 Gitea Wiki |

## 凭据

- `GITEA_TOKEN`：创建 Release、同步 Wiki。
- `PACKAGE_USERNAME` / `PACKAGE_PAT`：推送容器镜像。

## 镜像地址

```text
git.cellnucle.us/hugo/cageledger:<tag>
```
