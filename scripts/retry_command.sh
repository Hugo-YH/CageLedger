#!/usr/bin/env bash
set -euo pipefail

MAX_ATTEMPTS="${RETRY_MAX_ATTEMPTS:-3}"
BASE_DELAY_SECONDS="${RETRY_BASE_DELAY_SECONDS:-10}"

if [[ "$#" -eq 0 ]]; then
  echo "Usage: retry_command.sh <command> [arguments...]" >&2
  exit 2
fi

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
  if "$@"; then
    exit 0
  fi
  if [[ "$attempt" -eq "$MAX_ATTEMPTS" ]]; then
    echo "Command failed after ${MAX_ATTEMPTS} attempts: $*" >&2
    exit 1
  fi
  delay=$((BASE_DELAY_SECONDS * attempt))
  echo "Command failed on attempt ${attempt}/${MAX_ATTEMPTS}; retrying in ${delay}s: $*" >&2
  sleep "$delay"
done
