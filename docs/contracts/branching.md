# 分支策略

开发使用 `main`、`beta`、`rc` 三个长期分支。当前版本修复和小功能在同步后的 `main` 完成；下一大版本使用 `beta`，预发布整合使用 `rc`，不为常规任务新建临时开发分支。

云平台的 `work` 只是初始导入分支，核对已有工作后进入目标分支，不 reset 或丢弃改动。云端上游显式使用 Gitea 的 `gitea` remote；平台 GitHub `origin` 保留，不能把旧文档中的 `origin/main` 直接当成云端日常上游。操作见 [cloud-development.md](cloud-development.md)。

## 分支角色

| 分支   | 角色                                     | 合并方向                       |
| ------ | ---------------------------------------- | ------------------------------ |
| `main` | 当前版本的日常修复、小功能与正式版本源码 | 接收常规提交及已验证的 RC 整合 |
| `beta` | 下一大版本开发                           | 定期合入 `gitea/main`          |
| `rc`   | 合并 main 与 beta 的预发布整合           | 完成候选验证后由 main 接收     |

`main` 是正式版本的唯一发布出口；普通 main 提交不等于已发布版本。版本及更新检查以正式 Release 和不可变版本标签为准。

## 合并与验证

```text
main ──────────────► rc ──────────────► main
  │                  ▲
  └──► beta ─────────┘
```

- 新任务先 fetch 并比较当前分支；干净且仅落后时可快进。有修改、分叉或未知引用时保留现场，先分析。
- beta 定期合入 `gitea/main`；rc 发布候选前合入 `gitea/main` 与 `gitea/beta`，冲突在接收分支解决，不另写重复修复。
- RC 接收前验证最终整合状态；显式完整候选验证使用 `npm run verify:full`。日常修复按 [测试策略](testing-strategy.md) 选择相关检查，不因提交自动升级全量。
- main 接收 RC 时使用已核实的 `gitea/rc` 快进，不覆盖本地改动。正式发布后下一轮从新正式基线继续整合，分叉不强推。
- 不 rebase 已共享历史，不以 cherry-pick 代替长期分支的常规合并。清理旧分支前核对其提交已进入默认分支并推送。

## 发布入口的区别

云端 `release:cloud` 当前接受 main 上的正式 `X.Y.Z`，要求已有最终源码、匹配的本地及远端附注标签、已核验 ARM64 产物和 Packages 凭据。它不创建版本提交、不打标签、不运行测试或打包，也不接受 Mac 的 `--bump` 参数。准备及调用顺序见 [云端交付](cloud-development.md) 和 [发布工程](release-engineering.md)。

Mac 手动备用的 `release:local` 使用其独立检出的官方 Gitea `origin`，保留 `check_stable_release_ready.sh`／`check_rc_merged.sh` 的分支祖先与合并检查，以及预发布版本和 `--bump` 的原行为。不得为使该配置运行而改写云端导入 remote，也不能把 Mac 预发布能力当作云端正式 Release 命令的能力。

提交推送、标签、Packages、Release、latest 和生产部署各有授权边界；历史计划中的“未推送”或旧授权不覆盖当前用户指令。日常修改验证后及时提交推送的约定继续生效，普通代码备份不自动触发发布。
