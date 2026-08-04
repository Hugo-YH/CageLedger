#!/usr/bin/env bash
set -euo pipefail

# 在 rc 分支发布预发布版本前，强制确认 main 与 beta 的最新提交已合并进 rc。
# 用法：bash scripts/check_rc_merged.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git fetch origin main beta rc 2>/dev/null || git fetch origin 2>/dev/null

for branch in main beta; do
  if ! git merge-base --is-ancestor "origin/$branch" HEAD 2>/dev/null; then
    echo "rc 分支缺少 origin/$branch 的提交，禁止发布预发布版本。" >&2
    echo "请先在 rc 分支执行 git merge origin/$branch 解决冲突后再发布。" >&2
    exit 1
  fi
done

echo "rc 分支已包含 origin/main 与 origin/beta 的全部提交。"
