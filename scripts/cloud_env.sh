#!/usr/bin/env bash
# Source from the existing checkout; do not change the caller's shell options.
CAGELEDGER_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${CAGELEDGER_PROJECT_ROOT}/.venv/bin:$PATH"
if [[ -d /workspace/tooling/node_modules/.bin ]]; then
  export PATH="/workspace/tooling/node_modules/.bin:$PATH"
fi
export CAGELEDGER_GITEA_URL="${CAGELEDGER_GITEA_URL:-https://git.cellnucle.us}"
export CAGELEDGER_GITEA_REPOSITORY="${CAGELEDGER_GITEA_REPOSITORY:-hugo/cageledger}"
export CAGELEDGER_PYTHON_BIN="${CAGELEDGER_PYTHON_BIN:-${CAGELEDGER_PROJECT_ROOT}/.venv/bin/python}"
export CAGELEDGER_BUILDX_BUILDER="${CAGELEDGER_BUILDX_BUILDER:-cageledger-cloud}"
export CAGELEDGER_BUILD_PRUNE="${CAGELEDGER_BUILD_PRUNE:-1}"
