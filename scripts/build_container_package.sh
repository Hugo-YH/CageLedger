#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT}/package.json').version")"
REGISTRY="${CAGELEDGER_REGISTRY:-ddns.cellnucle.us:3333}"
NAMESPACE="${CAGELEDGER_IMAGE_NAMESPACE:-hugo}"
IMAGE_NAME="${CAGELEDGER_IMAGE_NAME:-cageledger}"
OUTPUT_DIR="${ROOT}/dist"
if [[ -n "${CAGELEDGER_BUILDX_BUILDER:-}" ]]; then
  BUILDER="$CAGELEDGER_BUILDX_BUILDER"
elif [[ "$(uname -s)" == Darwin ]]; then
  BUILDER="$(docker context show)"
else
  BUILDER=default
fi
PRUNE_CACHE="${CAGELEDGER_BUILD_PRUNE:-0}"

usage() {
  cat <<'EOF'
Build the ARM64 Docker-compatible offline archive without loading or pushing images.
Usage: bash scripts/build_container_package.sh [--registry host] [--namespace name] [--image-name name] [--builder name] [--output-dir path] [--prune-cache]
Version comes from package.json. Uses the local Docker socket.
Builder: --builder, then CAGELEDGER_BUILDX_BUILDER, then the local macOS context or Linux default.
Requires arm64 execution support (native, installed emulation, or bundled BuildKit QEMU).
Optional CA secrets: CODEX_PROXY_CERT and CAGELEDGER_BUILD_CA_BUNDLE.
Docker proxy defaults and registry authentication are preserved.
Managed packaging requires runtime-image.lock.json and reuses its immutable runtime.
Refresh changed dependencies explicitly with npm run runtime:refresh.
Set CAGELEDGER_BUILD_PRUNE=1 or --prune-cache to clear the dedicated cageledger-cloud
builder's cache after export; default/unknown builders are refused.
Set CAGELEDGER_BUILD_CACHE_LIMIT (cloud default 12GB) for bounded BuildKit GC instead
of clearing reusable dependency layers after every build.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry) REGISTRY="${2:?Missing registry}"; shift 2 ;;
    --namespace) NAMESPACE="${2:?Missing namespace}"; shift 2 ;;
    --image-name) IMAGE_NAME="${2:?Missing image name}"; shift 2 ;;
    --builder) BUILDER="${2:?Missing builder name}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:?Missing output directory}"; shift 2 ;;
    --prune-cache|--prune-between-architectures) PRUNE_CACHE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done

source "${ROOT}/scripts/docker_local.sh"

cd "$ROOT"
docker_local info >/dev/null
docker_local buildx version >/dev/null
case "$PRUNE_CACHE" in
  1|true|yes) PRUNE_CACHE=1 ;;
  0|false|no) PRUNE_CACHE=0 ;;
  *) echo "CAGELEDGER_BUILD_PRUNE must be 0 or 1" >&2; exit 1 ;;
esac
archive_tool() {
  node scripts/run_python.mjs scripts/container_archive.py "$@"
}
if [[ "$PRUNE_CACHE" -eq 1 || -n "${CAGELEDGER_BUILD_CACHE_LIMIT:-}" ]]; then
  docker_local buildx inspect "$BUILDER" | archive_tool check-builder --name "$BUILDER"
fi
REVISION="$(git rev-parse HEAD)"
IMAGE_REPO="${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}"
runtime_options=()
if [[ "$(uname -s)" == Darwin ]]; then
  runtime_context="$(node scripts/run_python.mjs scripts/runtime_image.py context --docker-registry "$REGISTRY")"
else
  runtime_context="$(node scripts/run_python.mjs scripts/runtime_image.py context)"
fi
runtime_options+=(--build-arg RUNTIME_IMAGE=runtime-base --build-context "runtime-base=${runtime_context}")
frontend_options=()
if [[ -n "${CAGELEDGER_FRONTEND_BUILD_RECEIPT:-}" ]]; then
  node scripts/run_python.mjs scripts/frontend_build.py validate --receipt "$CAGELEDGER_FRONTEND_BUILD_RECEIPT"
  frontend_options+=(--build-arg FRONTEND_OUTPUT=frontend-artifact --build-context "frontend-assets=${ROOT}/web-dist")
fi
secrets=()
if [[ -n "${CODEX_PROXY_CERT:-}" ]]; then
  [[ -f "$CODEX_PROXY_CERT" ]] || { echo "Configured build proxy CA file is missing" >&2; exit 1; }
  secrets+=(--secret "id=proxy_ca,src=${CODEX_PROXY_CERT}")
fi
build_bundle="${CAGELEDGER_BUILD_CA_BUNDLE:-/etc/ssl/certs/ca-certificates.crt}"
if [[ -f "$build_bundle" ]]; then
  secrets+=(--secret "id=ca_bundle,src=${build_bundle}")
elif [[ -n "${CAGELEDGER_BUILD_CA_BUNDLE:-}" ]]; then
  echo "Configured build CA bundle is missing" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
package_staging="$(mktemp -d "${OUTPUT_DIR}/.container-package-XXXXXX")"
cleanup_package_staging() {
  rm -rf "$package_staging"
}
trap cleanup_package_staging EXIT

archive_basename="CageLedger-image-${VERSION}-arm64"
image_tar="${package_staging}/${archive_basename}.tar"
docker_local buildx build --builder "$BUILDER" --platform linux/arm64 \
  "${runtime_options[@]}" \
  "${frontend_options[@]}" \
  "${secrets[@]}" \
  --build-arg "CAGELEDGER_APP_VERSION=${VERSION}" \
  --build-arg "CAGELEDGER_REVISION=${REVISION}" \
  --output "type=docker,dest=${image_tar}" -t "${IMAGE_REPO}:${VERSION}-arm64" .
archive_tool validate --archive "$image_tar" --architecture arm64 \
  --version "$VERSION" --revision "$REVISION" --image-tag "${IMAGE_REPO}:${VERSION}-arm64"
gzip -c "$image_tar" > "${package_staging}/${archive_basename}.tar.gz"
rm -f "$image_tar"
if [[ "$PRUNE_CACHE" -eq 1 ]]; then
  docker_local buildx prune --builder "$BUILDER" --all --force
elif [[ -n "${CAGELEDGER_BUILD_CACHE_LIMIT:-}" ]]; then
  docker_local buildx prune --builder "$BUILDER" --max-used-space "$CAGELEDGER_BUILD_CACHE_LIMIT" --force
fi

archive_tool finalize --staging "$package_staging" --output "$OUTPUT_DIR" \
  --version "$VERSION" --repository "$IMAGE_REPO"
