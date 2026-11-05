#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/package_offline_image.sh [--version 0.6.11] [--tag 0.6.11-abc1234] [--registry ddns.cellnucle.us:3333] [--namespace hugo] [--image-name cageledger]

Options:
  --version <ver>     Image version without leading v. Default: package.json version
  --tag <tag>         Full image tag to export. Default: <version>
  --registry <host>   Registry host. Default: ddns.cellnucle.us:3333
  --namespace <name>  Registry namespace. Default: hugo
  --image-name <name> Image name. Default: cageledger
  --local             Export existing local images without pulling; validate architecture/version
EOF
}

VERSION=""
IMAGE_TAG=""
REGISTRY="${CAGELEDGER_REGISTRY:-ddns.cellnucle.us:3333}"
NAMESPACE="${CAGELEDGER_IMAGE_NAMESPACE:-hugo}"
IMAGE_NAME="${CAGELEDGER_IMAGE_NAME:-cageledger}"
LOCAL_IMAGES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --tag)
      IMAGE_TAG="${2:-}"
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
    --local)
      LOCAL_IMAGES=1
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

IMAGE_REPO="${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}"
if [[ -z "$IMAGE_TAG" ]]; then
  IMAGE_TAG="${VERSION}"
fi
TAG="${IMAGE_TAG}"
OUT_DIR="${ROOT}/dist"
ARM_ARCHIVE="${OUT_DIR}/CageLedger-image-${TAG}-arm64.tar.gz"
LOAD_NOTES="${OUT_DIR}/CageLedger-image-${TAG}-load.txt"
CHECKSUMS="${OUT_DIR}/CageLedger-image-${TAG}-sha256.txt"

if [[ "$LOCAL_IMAGES" -eq 1 ]]; then
    docker image inspect "${IMAGE_REPO}:${TAG}-arm64" | node --input-type=module -e '
      let text = "";
      for await (const chunk of process.stdin) text += chunk;
      const image = JSON.parse(text)[0];
      const values = new Map((image.Config?.Env || []).map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }));
      if (image.Os !== "linux" || image.Architecture !== process.argv[1] || values.get("CAGELEDGER_APP_VERSION") !== process.argv[2]) {
        console.error("Local image architecture or application version does not match the requested package");
        process.exit(1);
      }
    ' arm64 "$VERSION"
else
  docker pull --platform linux/arm64 "${IMAGE_REPO}:${TAG}-arm64" >/dev/null
fi

mkdir -p "${OUT_DIR}"
rm -f "${ARM_ARCHIVE}" "${LOAD_NOTES}" "${CHECKSUMS}"

docker save "${IMAGE_REPO}:${TAG}-arm64" | gzip -c > "${ARM_ARCHIVE}"

cat > "${LOAD_NOTES}" <<EOF
CageLedger ${TAG} 离线镜像包

ARM64 主机：
  docker load -i $(basename "${ARM_ARCHIVE}")
  docker tag ${IMAGE_REPO}:${TAG}-arm64 ${IMAGE_REPO}:${TAG}

加载后可直接使用：
  docker run --rm -p 5173:5173 ${IMAGE_REPO}:${TAG}

如果使用 compose：
  将镜像 tag 固定为 ${TAG}
EOF

shasum -a 256 "${ARM_ARCHIVE}" "${LOAD_NOTES}" > "${CHECKSUMS}"

printf '%s\n%s\n%s\n' "${ARM_ARCHIVE}" "${LOAD_NOTES}" "${CHECKSUMS}"
