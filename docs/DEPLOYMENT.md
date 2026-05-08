# 部署说明

## Docker Compose

群晖或内网服务器建议使用 Docker Compose。

```bash
mkdir -p /volume1/docker/cageledger
cd /volume1/docker/cageledger
git clone https://github.com/Hugo-YH/CageLedger.git .
```

首次部署前，建议修改 `docker-compose.yml` 中的默认管理员密码：

```yaml
CAGELEDGER_ADMIN_PASSWORD=更强的密码
```

启动：

```bash
docker compose pull
docker compose up -d
```

访问：

```text
http://群晖IP:5173
```

默认使用 GitHub Container Registry 的 `latest` 镜像。如果希望固定到某个发布版本：

```bash
CAGELEDGER_IMAGE_TAG=0.4.3 docker compose up -d
```

## 数据持久化

默认数据保存在 Docker 命名卷 `cageledger-data` 中：

```text
/app/data/cageledger.sqlite
```

建议定期备份 `cageledger.sqlite`。

如果希望改成宿主机目录挂载，可以把 `docker-compose.yml` 中的卷改为：

```yaml
volumes:
  - ./data:/app/data
```

并先创建目录：

```bash
mkdir -p /volume1/docker/cageledger/data
```

## 更新

「数据管理 -> 系统更新」只负责检查 GitHub 最新提交，不会从网页自动拉取并运行新代码。

推荐更新流程：

```bash
git pull origin main
docker compose pull
docker compose up -d
```

如果固定了镜像标签，更新时同步调整 `CAGELEDGER_IMAGE_TAG`。

## NAS 离线源码构建

如果 NAS 无法连接外网，可以在本机打包源码，拖到 NAS 后本地构建镜像。

在本机项目目录生成离线包：

```bash
npm run package:offline
```

脚本会生成类似文件：

```text
dist/CageLedger-offline-v0.4.3.tar.gz
```

把这个文件上传到 NAS，例如 `/volume1/docker/`。然后在 NAS 的 SSH 终端执行：

```bash
cd /volume1/docker
tar -xzf CageLedger-offline-v0.4.3.tar.gz
cd CageLedger
docker compose -f docker-compose.offline.yml up -d --build
```

离线构建会使用 `docker-compose.offline.yml`，不需要访问 GHCR。数据仍保存在 Docker 命名卷 `cageledger-data` 中。

## GitHub Container Registry

容器镜像发布到 GitHub Container Registry：

```bash
docker pull ghcr.io/hugo-yh/cageledger:latest
docker pull ghcr.io/hugo-yh/cageledger:0.4.3
```

仓库内的 `Publish container package` GitHub Actions 工作流会在推送 `v*` 标签时发布镜像，也可以通过 `workflow_dispatch` 手动指定 Git ref 和镜像标签重新发布。
