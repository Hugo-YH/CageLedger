# 发布工程

Mac mini 执行发布，MacBook 负责日常开发与针对性验证。发布不会操作生产服务、原始数据库或附件；生产部署需要单独授权。测试范围与资源预算以 [测试策略](testing-strategy.md) 为准。

## 先诊断，再发布

```bash
npm run release:doctor
npm run release:doctor -- --online
npm run release:local -- --version X.Y.Z --push --dry-run
npm run release:local -- --version X.Y.Z --push
```

`doctor` 汇总 Node、Python、Git 身份、隔离检出、内存压力、锁定版本浏览器、Docker 和转换器的就绪状态。`--online` 额外只读检查 Git 远端与 Gitea API 仓库权限，不上传制品。它不是测试通过证明，也不能提前保证 Registry 写权限或未来网络可用。正式入口仍校验分支、版本占用、完整门禁和发布后的制品。

阶段顺序为：环境预检与资源准入 → 版本和更新记录 → 转换器冒烟 → 基础质量检查 → 应用与文档构建 → 浏览器完整门禁 → 离线包 → 发布提交与标签 → 镜像、Git 引用、Release、Wiki → 交付回读与冒烟 → `latest`。同版本输入、运行环境和产物完整匹配的通过结果自动复用；失败或结果不明不能当成通过。

## 签名与认证

**默认不签名。** 发布提交显式使用 `--no-gpg-sign`，标签显式使用附注标签 `-a` 并关闭该命令的自动签名；即使本机配置了 `commit.gpgsign=true`、`tag.gpgsign=true`，普通发布也不会访问签名密钥。不修改个人 Git 配置。

需要签名时明确选择：

```bash
npm run release:doctor -- --sign --online
npm run release:local -- --version X.Y.Z --push --sign
```

签名模式在临时 Git 仓库实际签署并验证提交、标签，提前发现密钥、allowed signers 和信任配置问题；发布时再次验证实际提交和标签。仅尝试恢复当前配置的 SSH identity 和登录用户的有效 agent，过程有超时，不创建密钥、不修改钥匙串策略、不打印凭据。失败停止，不自动改为无签名。

状态文件记录 `signed` / `unsigned`。创建提交意图或冻结发布输入后，续跑必须沿用原策略；历史状态文件若已进入提交阶段，按旧版签名策略处理，续跑加 `--sign`。冻结前可以调整策略，匹配的测试证据仍按原规则复用。

三种检查分别处理：

| 项目                       | 用途                                  | 默认发布是否需要                             |
| -------------------------- | ------------------------------------- | -------------------------------------------- |
| Git 提交/标签签名          | 证明提交者和标签发布者身份            | 可选，显式 `--sign`                          |
| Git、Gitea、Registry 认证  | 获取代码、推送和上传制品的权限        | 需要；不因关闭签名而取消                     |
| LibreOffice 应用签名与公证 | 核实测试转换器完整性与 macOS 可执行性 | 需要；使用供应商签名，不要求开发者自行签应用 |

## 开发目录中的测试工具

`CAGELEDGER_LIBREOFFICE_BIN` 显式路径优先，其次 `/Applications/LibreOffice.app`，再使用开发目录 `.codex-run/release-tools/` 的缓存。显式路径错误不会悄悄换工具。

缓存安装包保留在开发目录，不纳入 Git、离线包、架构扫描或 lint；转换器自带标准库不属于项目源码。每个 `libreoffice-*.json` 记录：

```json
{
  "version": "26.8.2",
  "image": "/absolute/development/release-tools/LibreOffice.dmg",
  "sha256": "填写从可信发布源核对的64位SHA256",
  "mount": "/absolute/development/release-tools/mounted-libreoffice"
}
```

缓存镜像和挂载点必须位于该工具目录内。入口核对镜像哈希，以只读方式挂载；正式发布继续检查完整应用签名、公证、版本以及实际 Writer → PDF 冒烟，不关闭安全检查。复用已挂载的同一镜像，不卸载操作者已有挂载；本次入口创建的挂载在退出时尝试卸载，失败明确报告保留路径，不强制卸载。不会自动下载或安装系统应用。

隔离发布检出可通过 `CAGELEDGER_RELEASE_TOOLS_DIR` 指向原开发目录的工具缓存。保持相同路径与版本有利于续跑；工具变化会使运行时凭据失效。浏览器从当前 Playwright 安装解析准确版本，覆盖 Chromium、headless shell、Firefox、WebKit 和 ffmpeg，不把历史缓存版本混入指纹。

## 进度与恢复

每个阶段显示开始、结束、耗时和日志路径；子进程运行期间约每 30 秒报告日志大小及最近输出时间。不会把可能含内部信息的子进程日志直接倾倒到终端。长时间没有新增输出不单独判失败；仍受资源保护和每阶段 60 分钟上限控制。

```bash
npm run release:status -- --state-dir /absolute/path/to/release-state/X.Y.Z
npm run release:local -- --version X.Y.Z --push --state-dir /absolute/path/to/release-state/X.Y.Z
```

`status` 只读状态文件；`running` 是日志记录，不保证对应进程仍存活。默认状态在仓库同级 `<仓库名>-release-state/<版本>/`，不可放进检出或打包目录。保持原检出、版本和状态目录续跑，不为了重试另开发布任务。原来使用 `--sign` 的续跑命令同样加 `--sign`。

- 本地失败：先修复原因，保留成功且仍匹配的阶段，重跑失败/失效部分。
- 资源保护停止：等待主机恢复，先查看已有任务，不盲目重启整套测试或增加超时、并发。
- 发布阶段 `unknown`：先核对远端。部分镜像、草稿、附件或冲突引用不得自动覆盖、重新 POST 或删除。
- 只有远端提交、标签、Release 正文与附件哈希、镜像、Wiki 和隔离冒烟均验证完成，才报告交付成功。生产部署状态另行说明。
