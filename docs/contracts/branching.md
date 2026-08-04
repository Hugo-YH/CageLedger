# 分支策略

本文件定义 CageLedger 的长期分支模型、合并方向和发布流程，作为日常开发与发布的统一约定。

## 分支角色

| 分支   | 角色                                           | 合并方向                        | 生命周期               |
| ------ | ---------------------------------------------- | ------------------------------- | ---------------------- |
| `main` | 默认分支；当前大版本的问题修复与新增小功能     | 只接收 rc 的正式发布            | 长期                   |
| `beta` | 下一大版本的功能开发线（UI、性能、新特性）     | 定期合并 `main`                 | 大版本上线后归档或重建 |
| `rc`   | 预发布整合线；合并 `main` 与 `beta` 的全部内容 | 发布 `vX.Y.Z-rcN` 后合回 `main` | 长期                   |

## 合并方向

```text
main ──────────────► rc ──────────────► main（正式发布 vX.Y.Z）
  │                  ▲
  │                  │
  └──► beta ─────────┘
       （定期合并 main）
```

### 约定

- `main` 是唯一正式发布出口，正式版本号以 `main` 上的 `v*` tag 为准。
- `beta` 专注下一大版本功能，不直接发布正式版本。
- `rc` 是 `main + beta` 的整合线，只做整合与验证，不开发新功能。
- `beta` 每次在 `main` 发版后执行 `git merge origin/main`，先自行消化生产修复，避免与 `main` 长期分叉。
- `rc` 每次发布 `vX.Y.Z-rcN` 前执行 `git merge origin/main` 与 `git merge origin/beta`，再运行 `npm run verify:full`。
- 合并冲突在接收方分支解决；涉及结算、权限、导出等共享文件时保留双方语义并跑全量验证。

## 发布流程

### 正式版（main）

1. 在 `main` 上更新 release notes。
2. 运行 `npm run release:local -- --version X.Y.Z --push`。

### 预发布版（rc）

1. 在 `rc` 上执行 `git fetch origin`。
2. 执行 `git merge origin/main` 与 `git merge origin/beta`，解决冲突。
3. 更新 release notes 并设置版本 `X.Y.Z-rcN`。
4. 运行 `npm run verify:full` 全量验证。
5. 运行发布脚本（同正式版命令），发布 `vX.Y.Z-rcN`。

## 修复迁移

- `main` 上的生产修复保持小而独立，一个 bug 一个提交，避免夹带无关重构。
- `rc` 遇到与 `main` 相同的问题时，优先通过合并 `main` 引入修复，不在 `rc` 上另写一份。
- 合并频率建议 1-3 天一次，或每次 `main` 发版后立即合并，冲突范围随间隔线性增长。

## 禁止事项

- 不在 `beta` 或 `rc` 上直接发布正式版本号。
- 不用 cherry-pick 替代定期 merge；merge 保留唯一来源，Git 自动去重已合并提交。
- 不 rebase 已共享的历史（`beta` 发布 tag 和 `rc` 历史依赖 merge 结构）。
