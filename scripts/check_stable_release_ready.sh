#!/usr/bin/env bash
set -euo pipefail

# 正式版必须从 main 发布，并包含当前 rc 的已验证提交。

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "正式发布必须在 main 分支执行。" >&2
  exit 1
fi

if ! git fetch origin main rc 2>/dev/null && ! git fetch origin 2>/dev/null; then
  echo "无法从 origin 获取分支，请确认网络与 Git 凭据：" >&2
  echo "  后台会话需配置 ~/.git-cageledger-credentials（权限 600）或设置 CAGELEDGER_GITEA_TOKEN。" >&2
  exit 1
fi

if ! git merge-base --is-ancestor origin/rc HEAD 2>/dev/null; then
  echo "main 缺少 origin/rc 的已验证提交，禁止发布正式版本。" >&2
  echo "请先将 rc 快进或合并到 main，再执行发布。" >&2
  exit 1
fi

echo "main 已包含 origin/rc，可发布正式版本。"
