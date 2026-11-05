#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="${CAGELEDGER_REGISTRY:-ddns.cellnucle.us:3333}"
NAMESPACE="${CAGELEDGER_IMAGE_NAMESPACE:-hugo}"
BASE_REPO="${REGISTRY}/${NAMESPACE}/${CAGELEDGER_BASE_IMAGE_NAME:-cageledger-base}"

cd "$ROOT"
docker buildx build --target frontend-deps --platform linux/arm64 \
  --build-arg NODE_IMAGE="${BASE_REPO}:node-22-bookworm-slim" \
  --build-arg PYTHON_IMAGE="${BASE_REPO}:python-3.13-slim" \
  --output type=cacheonly .
docker buildx build --target runtime-deps --platform linux/arm64 \
    --build-arg NODE_IMAGE="${BASE_REPO}:node-22-bookworm-slim" \
    --build-arg PYTHON_IMAGE="${BASE_REPO}:python-3.13-slim" \
    --output type=cacheonly .
