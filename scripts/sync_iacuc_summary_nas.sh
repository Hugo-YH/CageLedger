#!/usr/bin/env bash
#
# 群晖（ARM）IACUC 汇总表同步脚本
#
# 检测群晖上的“动物实验申请汇总表”是否变化（内容指纹），有变化时复制一份
# 到 CageLedger 数据目录的 inbox/iacuc/，供系统自动导入。复制文件名带时间戳，
# 系统导入成功后会把文件移入 archive/iacuc/，因此 inbox 不会无限堆积。
#
# 用法：
#   bash scripts/sync_iacuc_summary_nas.sh once   # 单次检查并复制（群晖任务计划推荐）
#   bash scripts/sync_iacuc_summary_nas.sh watch  # 持续监听，默认每 60 秒检查一次
#
# 可用环境变量：
#   IACUC_SUMMARY_SOURCE        源汇总表路径
#   IACUC_SUMMARY_INBOX         目标 inbox 目录
#   IACUC_SUMMARY_STATE         指纹状态文件路径（默认放在 inbox 下）
#   IACUC_SUMMARY_WATCH_INTERVAL watch 模式检查间隔秒数
#
set -euo pipefail

SOURCE_FILE="${IACUC_SUMMARY_SOURCE:-/volume1/EAC/01 伦理实验管理/01b 动物实验申请管理/动物实验申请汇总表（2022起-更新中）.xlsx}"
DEST_DIR="${IACUC_SUMMARY_INBOX:-/volume1/docker/cageledger/data/inbox/iacuc}"
STATE_FILE="${IACUC_SUMMARY_STATE:-${DEST_DIR}/.last-summary-sync}"
WATCH_INTERVAL="${IACUC_SUMMARY_WATCH_INTERVAL:-60}"
MODE="${1:-once}"

fingerprint() {
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$SOURCE_FILE" | awk '{print $1}'
  else
    cksum "$SOURCE_FILE" | awk '{print $1}'
  fi
}

copy_latest() {
  mkdir -p "$DEST_DIR"
  local stamp target n
  stamp="$(date +%Y%m%d-%H%M%S)"
  target="$DEST_DIR/动物实验申请汇总表-${stamp}.xlsx"
  n=1
  while [[ -e "$target" ]]; do
    target="$DEST_DIR/动物实验申请汇总表-${stamp}-${n}.xlsx"
    n=$((n + 1))
  done
  cp -p "$SOURCE_FILE" "$target"
  fingerprint > "$STATE_FILE"
  echo "synced: $target"
}

run_once() {
  if [[ ! -f "$SOURCE_FILE" ]]; then
    echo "source not found: $SOURCE_FILE" >&2
    return 1
  fi
  local current last
  current="$(fingerprint)"
  last="$(cat "$STATE_FILE" 2>/dev/null || true)"
  if [[ -n "$last" && "$current" == "$last" ]]; then
    echo "unchanged"
    return 0
  fi
  copy_latest
}

case "$MODE" in
  once)
    run_once
    ;;
  watch)
    while true; do
      if [[ -f "$SOURCE_FILE" ]]; then
        run_once || true
      else
        echo "source not found, waiting..." >&2
      fi
      sleep "$WATCH_INTERVAL"
    done
    ;;
  *)
    echo "usage: $0 [once|watch]" >&2
    exit 2
    ;;
esac
