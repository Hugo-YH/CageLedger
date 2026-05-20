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

## 发布前检查

```bash
npm run check
python3 -m py_compile server.py server_app/*.py server_app/repositories/*.py server_app/services/*.py
npm run smoke:api
npm run package:offline
```

## Gitea Actions 分工

| 工作流 | 作用 |
| --- | --- |
| `release-package.yml` | 创建 Release、上传离线包 |
| `publish-container.yml` | 构建并推送容器镜像 |
| `sync-wiki.yml` | 同步 `wiki/` 到 Gitea Wiki |

`wiki/**` 变更合入 `main` 后会触发 Wiki 同步；版本发布 tag 会触发 Release 离线包和容器镜像发布。

## 凭据

- `GITEA_TOKEN`：创建 Release、同步 Wiki。
- `PACKAGE_USERNAME` / `PACKAGE_PAT`：推送容器镜像。

## 镜像地址

```text
git.cellnucle.us/hugo/cageledger:<tag>
```
