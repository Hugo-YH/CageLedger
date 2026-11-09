# 发布与 CI-CD

日常开发与正式交付以 Codex 云端和 Gitea 为主，生产目标为 DS223 的 `linux/arm64`。普通修改验证后提交推送，不自动升级版本、打包或发布；Packages、Release、latest 与生产部署分别按任务授权执行。Mac mini 只保留手动备用配置。

## 云端正式交付

```text
确定版本与更新记录
→ 对最终源码做相关验证、提交并推送
→ 同一提交构建 ARM64 产物并冒烟
→ 创建并推送不可变附注版本标签
→ publish:registry：推送并核验同版本 Packages
→ release:cloud --publish：核验标签、产物与 Packages，发表 Release
→ 显式核验并更新 latest
```

`release:cloud` **不负责自动改版本、运行测试、构建、提交、创建标签或推送代码**；它要求这些准备已经完成。修改最终源码会使相关构建和验证凭据失效，不得把脏工作区产物仅标记成旧提交。

版本与 build 的唯一源为 `package.json`。准备新版本时使用 `scripts/set_version.mjs` 同步，再维护 `wiki/更新日志.md` 并运行 `npm run release:notes:sync`。Git 标签为 `v<version>`，镜像为 `<version>` / `<version>-arm64`，build 仅用于系统展示。已有正式版本、标签与制品不可覆盖。

相关验证的选择以 `docs/contracts/testing-strategy.md` 为准，复用输入相同且仍有效的证据；不因提交或发布标签本身默认重跑全量。完整三浏览器门禁只有实际完成后才可声称通过，云端 WebKit 依赖限制不能用普通构建结果替代。

## 构建和运行依赖

仅在明确构建或交付任务中执行 `npm run package:managed`；它在宿主锁和资源保护下共享构建应用与文档，再生成本地源码归档及 ARM64 镜像归档。源码归档可用于构建来源核验，**Codex 不上传离线源码包**；Gitea 本地源码包构建另行配置，Gitea 自带的源码下载不变。

生产运行环境由 `runtime-image.lock.json` 和 `requirements-runtime.txt` 固定。应用构建复用不可变依赖镜像，依赖输入变化时须显式执行 `npm run runtime:refresh` 并提交新锁；不移动业务版本或 latest。不要通过每次清空缓存和重新安装依赖替代该机制。

## Packages 与正式 Release

以下命令假定最终代码已提交推送，匹配的 `vX.Y.Z` 附注标签已推送，同提交 ARM64 归档与来源校验均已完成：

```bash
npm run publish:registry -- --archive dist/CageLedger-image-X.Y.Z-arm64.tar.gz --state-dir ../CageLedger-registry-state/X.Y.Z
npm run release:cloud -- --publish
npm run publish:registry -- --archive dist/CageLedger-image-X.Y.Z-arm64.tar.gz --state-dir ../CageLedger-registry-state/X.Y.Z --update-latest
```

默认 Release 附件只有小型来源／镜像摘要清单、拉取指引与权限探针。Packages 按同摘要层复用，新增内容才上传；Release 验证已有同版本 Packages 凭据及远端索引、manifest、config 和 blob 身份。正式 Release 完成后才可更新 latest；该步骤不部署 NAS。

明确需要完整离线镜像时，将 Release 命令改为：

```bash
npm run release:cloud -- --offline-image --publish
```

此时额外上传镜像分片、加载说明、SHA256 与重组脚本，仍不上传源码包。轻量模式与离线模式使用不同凭据，不给既有正式版本补附其他模式的附件。

开发草稿的离线附件使用 `npm run publish:cloud -- --offline-image`；未提供开关会拒绝，开发草稿不等同正式 Release。详细准备、认证和续传规则见仓库 `docs/contracts/cloud-development.md`。

## Git、认证和分支

云端代码上游为 `https://git.cellnucle.us/hugo/cageledger.git`，显式使用 `gitea` remote；平台导入的 GitHub `origin` 保留，不覆盖。

```bash
source scripts/cloud_env.sh
node scripts/run_python.mjs scripts/gitea_git.py fetch gitea
```

常规修复在同步后的 `main` 开发，下一大版本使用 `beta`，整合候选使用 `rc`。云端 `release:cloud` 当前只支持 main 的正式 `X.Y.Z`；不能把旧 Mac `--bump` 或预发布参数当作该命令参数。

网络凭据由云环境按 HTTPS 主机注入，Git 使用包装器。Registry 使用独立的 `CAGELEDGER_GITEA_REGISTRY_BASIC` 绑定，不将代理 Token 占位值自行编码为 Docker 密码，也不写入凭据文件。生产镜像拉取地址与云端 API 地址分别配置。

## 手动 Mac 备用

`npm run release:local -- --version X.Y.Z --push` 保留 Mac 平台的完整受管流程、转换器信任、浏览器门禁、镜像与附件核验及 Wiki 迁移入口同步。其 `doctor`、`status`、`--bump`、Colima、钥匙串及固定工具缓存属于该配置，不能套用于云端默认入口。

Mac 正式发布脚本要求其独立检出的官方 Gitea `origin`；这不授权修改云端检出的 GitHub `origin`。现有 RC 合并检查、平台专用校验和资源保护继续保留，不能据云端 Packages／Release 可用宣称 Mac 完整管线已迁移到 Linux。详见仓库 `docs/contracts/release-engineering.md` 与 `macos-gitea-runner.md`。

## 续传与交付核对

失败后保留仓库外的同版本状态目录，先核对远端结果，再恢复匹配的步骤。摘要或所有权冲突时停止，不移动标签、不覆盖制品；`--audit-remote` 可显式重读远端附件。权限探针验证真实匿名访问边界，不能用私有元数据返回 401 替代文件权限验证。

交付报告核对代码和附注标签、Packages 同版本摘要、Release 正文与附件、应用版本和来源 revision。latest 是否更新、NAS 是否部署分别报告。文档由 `wiki/` 构建到应用 `/docs/`，Gitea Wiki 只是迁移入口。

整理前的详细说明保存在仓库 `docs/archives/documentation-baseline-2026-11-09/release-guide-before.md`，只供追溯。
