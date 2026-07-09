#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/publish_container_local.sh [--version 0.6.11] [--registry git.cellnucle.us] [--namespace hugo] [--image-name cageledger] [--base-image-name cageledger-base] [--export-offline-images] [--skip-base-sync]

Options:
  --version <ver>          Release version without leading v. Default: package.json version
  --registry <host>        Registry host. Default: git.cellnucle.us
  --namespace <name>       Registry namespace. Default: hugo
  --image-name <name>      Application image name. Default: cageledger
  --base-image-name <name> Base image repo name. Default: cageledger-base
  --export-offline-images  Export dist/ offline image tar.gz after publish
  --skip-base-sync         Reuse current cageledger-base tags and skip public mirror sync
EOF
}

VERSION=""
REGISTRY="${CAGELEDGER_REGISTRY:-git.cellnucle.us}"
NAMESPACE="${CAGELEDGER_IMAGE_NAMESPACE:-hugo}"
IMAGE_NAME="${CAGELEDGER_IMAGE_NAME:-cageledger}"
BASE_IMAGE_NAME="${CAGELEDGER_BASE_IMAGE_NAME:-cageledger-base}"
EXPORT_OFFLINE_IMAGES=0
SYNC_BASE_IMAGES=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --registry)
      REGISTRY="${2:-}"
      shift 2
      ;;
    --namespace)
      NAMESPACE="${2:-}"
      shift 2
      ;;
    --image-name)
      IMAGE_NAME="${2:-}"
      shift 2
      ;;
    --base-image-name)
      BASE_IMAGE_NAME="${2:-}"
      shift 2
      ;;
    --export-offline-images)
      EXPORT_OFFLINE_IMAGES=1
      shift
      ;;
    --skip-base-sync)
      SYNC_BASE_IMAGES=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('${ROOT}/package.json').version")"
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.-]*$ ]]; then
  echo "Version must look like 0.6.11 or 0.6.11a" >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || {
  echo "docker is required" >&2
  exit 1
}

docker info >/dev/null 2>&1 || {
  echo "docker daemon is unavailable" >&2
  exit 1
}

docker buildx version >/dev/null 2>&1 || {
  echo "docker buildx is required" >&2
  exit 1
}

IMAGE_REPO="${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}"
BASE_REPO="${REGISTRY}/${NAMESPACE}/${BASE_IMAGE_NAME}"
TAG="v${VERSION}"
SOURCE_REF="HEAD"

cd "${ROOT}"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  SOURCE_REF="refs/tags/${TAG}"
fi

if [[ "${SOURCE_REF}" == "HEAD" ]]; then
  PACKAGE_VERSION="$(node -p "require('${ROOT}/package.json').version")"
  if [[ "${PACKAGE_VERSION}" != "${VERSION}" ]]; then
    echo "package.json version ${PACKAGE_VERSION} does not match requested ${VERSION}" >&2
    exit 1
  fi
fi

if [[ "${SYNC_BASE_IMAGES}" -eq 1 ]]; then
  docker buildx imagetools create \
    -t "${BASE_REPO}:node-22-bookworm-slim" \
    docker.io/library/node:22-bookworm-slim >/dev/null
  docker buildx imagetools create \
    -t "${BASE_REPO}:python-3.13-slim" \
    docker.io/library/python:3.13-slim >/dev/null
fi

WORKTREE_DIR="$(mktemp -d /tmp/cageledger-release-${VERSION}-XXXXXX)"
cleanup() {
  git worktree remove --force "${WORKTREE_DIR}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git worktree add --detach "${WORKTREE_DIR}" "${SOURCE_REF}" >/dev/null
REVISION="$(git -C "${WORKTREE_DIR}" rev-parse HEAD)"

docker buildx build \
  --platform linux/arm64 \
  --build-arg NODE_IMAGE="${BASE_REPO}:node-22-bookworm-slim" \
  --build-arg PYTHON_IMAGE="${BASE_REPO}:python-3.13-slim" \
  --build-arg CAGELEDGER_APP_VERSION="${VERSION}" \
  --build-arg CAGELEDGER_REVISION="${REVISION}" \
  -t "${IMAGE_REPO}:${TAG}-arm64" \
  --push \
  "${WORKTREE_DIR}"

docker buildx build \
  --platform linux/amd64 \
  --build-arg NODE_IMAGE="${BASE_REPO}:node-22-bookworm-slim" \
  --build-arg PYTHON_IMAGE="${BASE_REPO}:python-3.13-slim" \
  --build-arg CAGELEDGER_APP_VERSION="${VERSION}" \
  --build-arg CAGELEDGER_REVISION="${REVISION}" \
  -t "${IMAGE_REPO}:${TAG}-amd64" \
  --push \
  "${WORKTREE_DIR}"

docker buildx imagetools create \
  -t "${IMAGE_REPO}:${TAG}" \
  "${IMAGE_REPO}:${TAG}-amd64" \
  "${IMAGE_REPO}:${TAG}-arm64" >/dev/null

docker buildx imagetools inspect "${IMAGE_REPO}:${TAG}" >/dev/null

if [[ "${EXPORT_OFFLINE_IMAGES}" -eq 1 ]]; then
  bash "${ROOT}/scripts/package_offline_image.sh" \
    --version "${VERSION}" \
    --registry "${REGISTRY}" \
    --namespace "${NAMESPACE}" \
    --image-name "${IMAGE_NAME}" >/dev/null
fi

printf '%s\n%s\n%s\n' \
  "${IMAGE_REPO}:${TAG}" \
  "${IMAGE_REPO}:${TAG}-amd64" \
  "${IMAGE_REPO}:${TAG}-arm64"
