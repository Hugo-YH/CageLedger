#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/package_offline_image.sh [--version 0.6.11] [--registry git.cellnucle.us] [--namespace hugo] [--image-name cageledger]

Options:
  --version <ver>     Image version without leading v. Default: package.json version
  --registry <host>   Registry host. Default: git.cellnucle.us
  --namespace <name>  Registry namespace. Default: hugo
  --image-name <name> Image name. Default: cageledger
EOF
}

VERSION=""
REGISTRY="${CAGELEDGER_REGISTRY:-git.cellnucle.us}"
NAMESPACE="${CAGELEDGER_IMAGE_NAMESPACE:-hugo}"
IMAGE_NAME="${CAGELEDGER_IMAGE_NAME:-cageledger}"

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

IMAGE_REPO="${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}"
TAG="v${VERSION}"
OUT_DIR="${ROOT}/dist"
AMD_ARCHIVE="${OUT_DIR}/CageLedger-image-${TAG}-amd64.tar.gz"
ARM_ARCHIVE="${OUT_DIR}/CageLedger-image-${TAG}-arm64.tar.gz"
LOAD_NOTES="${OUT_DIR}/CageLedger-image-${TAG}-load.txt"
CHECKSUMS="${OUT_DIR}/CageLedger-image-${TAG}-sha256.txt"

mkdir -p "${OUT_DIR}"
rm -f "${AMD_ARCHIVE}" "${ARM_ARCHIVE}" "${LOAD_NOTES}" "${CHECKSUMS}"

docker pull --platform linux/amd64 "${IMAGE_REPO}:${TAG}-amd64" >/dev/null
docker pull --platform linux/arm64 "${IMAGE_REPO}:${TAG}-arm64" >/dev/null

docker save "${IMAGE_REPO}:${TAG}-amd64" | gzip -c > "${AMD_ARCHIVE}"
docker save "${IMAGE_REPO}:${TAG}-arm64" | gzip -c > "${ARM_ARCHIVE}"

cat > "${LOAD_NOTES}" <<EOF
CageLedger ${TAG} 离线镜像包

AMD64 主机：
  docker load -i $(basename "${AMD_ARCHIVE}")
  docker tag ${IMAGE_REPO}:${TAG}-amd64 ${IMAGE_REPO}:${TAG}

ARM64 主机：
  docker load -i $(basename "${ARM_ARCHIVE}")
  docker tag ${IMAGE_REPO}:${TAG}-arm64 ${IMAGE_REPO}:${TAG}

加载后可直接使用：
  docker run --rm -p 5173:5173 ${IMAGE_REPO}:${TAG}

如果使用 compose：
  将镜像 tag 固定为 ${TAG}
EOF

shasum -a 256 "${AMD_ARCHIVE}" "${ARM_ARCHIVE}" "${LOAD_NOTES}" > "${CHECKSUMS}"

printf '%s\n%s\n%s\n%s\n' "${AMD_ARCHIVE}" "${ARM_ARCHIVE}" "${LOAD_NOTES}" "${CHECKSUMS}"
