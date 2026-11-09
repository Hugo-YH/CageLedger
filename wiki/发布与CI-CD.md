# 发布与 CI/CD

本页面向准备版本交付的维护者，说明云端构建、Gitea Packages、正式 Release、latest 和部署之间的顺序及验证结果。当前主线是 Codex 云端与 Gitea，生产目标为 DS223 的 `linux/arm64`；普通代码修改验证后提交推送，正式交付按任务授权执行，Mac mini 保留手动备用配置。

## 一次正式交付的结果

<DocFigure src="/diagrams/release-delivery.svg" kind="diagram" alt="最终源码验证后构建并核验 ARM64 产物，发布 Packages 和 Release，再显式推进 latest 与部署" caption="逐项核对源码、标签、镜像和 Release；latest 更新与生产部署分别记录结果。" />

| 对象         | 完成结果                                        |
| ------------ | ----------------------------------------------- |
| 源码与版本   | 最终代码已验证、提交并推送，版本记录一致        |
| 版本标签     | 本地与远端存在匹配提交的不可变附注标签 `vX.Y.Z` |
| ARM64 产物   | 与该提交对应，版本、平台、来源和冒烟有效        |
| Packages     | 同版本镜像上传并核验，摘要及远端身份一致        |
| Release      | 正文与更新日志一致，附件和访问边界核验通过      |
| latest／生产 | 仅在单独执行后报告其更新或部署结果              |

## 1. 冻结版本与验证范围

版本与 build 的唯一源是 `package.json`。使用 `scripts/set_version.mjs` 同步版本，维护 `wiki/更新日志.md`，再运行 `npm run release:notes:sync`。Git 标签为 `v<version>`，镜像为 `<version>`／`<version>-arm64`，数字 build 仅用于系统展示。

对最终源码按仓库 `docs/contracts/testing-strategy.md` 选择质量检查和相关回归，保留与输入相符的有效证据。共享基础变化、高风险改动或明确要求时扩大范围；完整三浏览器门禁只有实际完成后才可声称通过，不能用构建替代缺失的引擎结果。

随后提交并推送最终代码。源码发生变化时重新评估受影响验证和构建凭据，不能把脏工作区产物标记成旧提交的产物。

## 2. 构建 ARM64 产物并准备标签

明确交付任务中使用 `npm run package:managed`。该命令在宿主锁和资源保护下，共享构建应用与文档，生成本地源码归档及 ARM64 镜像归档，并校验归档身份。构建后还需完成最终产物冒烟，保存对应凭据。

源码归档可用于构建来源核验，Codex 不上传离线源码包；离线源码包由 Gitea 本地另行配置构建，Gitea 自带源码下载不变。当前仅构建新 ARM64 镜像，历史 AMD64 制品保留。

完成同提交产物与冒烟后，按发布契约准备并推送对应附注版本标签。已存在的正式版本、标签和制品不可覆盖。分支和标签的具体准备命令见仓库 `docs/contracts/cloud-development.md`，不要把 Mac 的 `--bump` 当作云端参数。

### 锁定的运行依赖

`runtime-image.lock.json` 和 `requirements-runtime.txt` 固定不可变生产运行环境。普通应用构建复用已验证依赖层；依赖输入变化时须显式执行 `npm run runtime:refresh` 并提交新锁。运行环境使用内容寻址标签，不移动业务版本或 latest，不能通过反复清空缓存、重新安装依赖代替刷新机制。

## 3. 推送 Packages，再发表 Release

以下命令中的 `X.Y.Z` 需替换为目标版本。执行前必须已有最终源码、匹配的本地及远端附注标签、同提交 ARM64 归档、有效来源与冒烟凭据。

```bash
npm run publish:registry -- --archive dist/CageLedger-image-X.Y.Z-arm64.tar.gz --state-dir ../CageLedger-registry-state/X.Y.Z
npm run release:cloud -- --publish
```

`release:cloud` 校验已备好的标签、产物、Packages 凭据及远端镜像身份，然后发表 Release。它不自动改版本、测试、构建、提交、创建标签或推送代码。当前入口仅支持 `main` 上的正式 `X.Y.Z`。

默认 Release 只附小型来源／镜像摘要清单、拉取指引和权限探针。Packages 按同摘要层复用，Release 核验远端索引、manifest、config 与 blob 身份；镜像拉取时的 tag／digest 机制可参考 Docker 官方说明。<sup>[1](#参考资料)</sup>

正式 Release 完成后，需要更新 latest 时再显式执行：

```bash
npm run publish:registry -- --archive dist/CageLedger-image-X.Y.Z-arm64.tar.gz --state-dir ../CageLedger-registry-state/X.Y.Z --update-latest
```

该步骤仍不部署 NAS。生产升级另按[部署与运行](/operations/deployment#升级与回滚)执行。

### 按需提供完整离线镜像

明确需要离线交付时，将 Release 命令改为：

```bash
npm run release:cloud -- --offline-image --publish
```

该模式额外上传镜像分片、加载说明、SHA256 与重组脚本，并完整回读核验，仍不上传源码包。轻量模式与离线模式使用不同凭据，不给已有正式版本补附另一模式的附件。

开发草稿使用 `npm run publish:cloud -- --offline-image`；缺少开关会被拒绝。开发草稿不等同正式 Release，详细认证、状态目录和续传规则见仓库 `docs/contracts/cloud-development.md`。

## 云端远端、凭据与分支

云端官方上游为 `https://git.cellnucle.us/hugo/cageledger.git`，显式使用 `gitea` remote，保留平台 GitHub `origin`：

```bash
source scripts/cloud_env.sh
node scripts/run_python.mjs scripts/gitea_git.py fetch gitea
```

常规修复在同步后的 `main`，下一大版本使用 `beta`，候选整合使用 `rc`，见仓库 `docs/contracts/branching.md`。网络凭据由云环境按 HTTPS 主机注入，Git 使用包装器；Registry 使用独立 `CAGELEDGER_GITEA_REGISTRY_BASIC` 绑定，不将代理 Token 占位值编码为 Docker 密码，不写入凭据文件。生产拉取地址与云端 API 地址分别配置。

## 失败恢复与交付核对

保留仓库外同版本状态目录，先核对远端结果，再从匹配步骤恢复。摘要或所有权冲突时停止，不移动标签、不覆盖制品；需要重新审计时可显式使用 `--audit-remote`。权限探针验证真实匿名访问边界，不能以私有元数据返回 `401` 替代文件访问验证。

交付记录应给出源码提交、附注标签、Packages 同版本摘要、Release 正文与附件、应用版本及来源 revision，并单列 latest 是否更新、NAS 是否部署。文档由 `wiki/` 构建到 `/docs/`，Gitea Wiki 仅保留迁移入口。

## Mac 手动备用配置

`npm run release:local -- --version X.Y.Z --push` 保留 Mac 平台完整受管流程，包括转换器信任、浏览器门禁、镜像和附件核验、Wiki 迁移入口同步。其 `doctor`、`status`、`--bump`、Colima、钥匙串与工具缓存属于该配置。

Mac 正式发布脚本要求其独立检出的官方 Gitea `origin`，不能据此改写云端 GitHub `origin`。RC 合并、平台专用检查和资源保护继续保留；云端 Packages／Release 可用不证明 Mac 完整管线已迁移到 Linux。备用环境与完整门禁见仓库 `docs/contracts/release-engineering.md` 和 `macos-gitea-runner.md`。

## 参考资料

1. [Docker：docker image pull](https://docs.docker.com/reference/cli/docker/image/pull/)：解释镜像标签、摘要和分层拉取；CageLedger 的发布顺序、凭据及不可覆盖规则由项目发布契约定义。
