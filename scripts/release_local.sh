#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/release_local.sh --version 0.4.1 [--push] [--dry-run] [--skip-full-verify] [--skip-container-publish] [--skip-offline-image]
  bash scripts/release_local.sh 0.4.1 [--push] [--dry-run] [--skip-full-verify] [--skip-container-publish] [--skip-offline-image]

Options:
  --version <ver>  Release version, for example 0.4.1 or 0.4.0a
  --push           Push main and the new v<version> tag after commit/tag
  --dry-run        Print steps without executing them
  --skip-full-verify  Skip the Mac mini production build and Playwright release verification
  --skip-container-publish  Skip Mac mini local multi-arch image publish before push
  --skip-offline-image      Skip dist/ image tar.gz export during local container publish
EOF
}

VERSION=""
PUSH=0
DRY_RUN=0
PUBLISH_CONTAINER=1
EXPORT_OFFLINE_IMAGE=1
FULL_VERIFY=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --push)
      PUSH=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --skip-full-verify)
      FULL_VERIFY=0
      shift
      ;;
    --skip-container-publish)
      PUBLISH_CONTAINER=0
      shift
      ;;
    --skip-offline-image)
      EXPORT_OFFLINE_IMAGE=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$VERSION" ]]; then
        VERSION="$1"
        shift
      else
        echo "Unknown argument: $1" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$VERSION" ]] || [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.-]*$ ]]; then
  echo "Release version is required and must look like 0.4.1 or 0.4.0a" >&2
  usage
  exit 1
fi

run() {
  echo "+ $*"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    "$@"
  fi
}

cd "$ROOT"

if [[ -n "${CAGELEDGER_PYTHON_BIN:-}" ]]; then
  PYTHON_BIN_DIR="$(dirname "$CAGELEDGER_PYTHON_BIN")"
  export PATH="$PYTHON_BIN_DIR:$PATH"
elif [[ -x "$ROOT/.venv/bin/python3" ]]; then
  export PATH="$ROOT/.venv/bin:$PATH"
fi

python3 - <<'PY'
import sys

if sys.version_info < (3, 13):
    raise SystemExit("CageLedger release requires Python 3.13. Activate .venv or set CAGELEDGER_PYTHON_BIN.")
PY

if git rev-parse -q --verify "refs/tags/v${VERSION}" >/dev/null; then
  echo "Local tag v${VERSION} already exists." >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/v${VERSION}" >/dev/null 2>&1; then
  echo "Remote tag v${VERSION} already exists on origin." >&2
  exit 1
fi

run node scripts/set_version.mjs --version "$VERSION"

MATCH_COUNT="$(rg -l -F "version: \"${VERSION}\"" src/react/releaseNotes*.ts | wc -l | tr -d ' ')"
if [[ "${MATCH_COUNT:-0}" -lt 1 ]]; then
  echo "src/react/releaseNotes*.ts is missing a dedicated ${VERSION} release note. Update release notes first." >&2
  exit 1
fi

if [[ "$FULL_VERIFY" -eq 1 ]]; then
  run npm run verify:full
else
  run npm run check
fi
OFFLINE_PACKAGE_PATH="${ROOT}/dist/CageLedger-offline-v${VERSION}.tar.gz"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "+ npm run package:offline"
else
  echo "+ npm run package:offline"
  OFFLINE_PACKAGE_PATH="$(npm run --silent package:offline)"
  if [[ ! -f "$OFFLINE_PACKAGE_PATH" ]]; then
    echo "Offline package was not created: $OFFLINE_PACKAGE_PATH" >&2
    exit 1
  fi
fi
run git add -A -- . ':(exclude)data.zip'
run git commit -m "Release v${VERSION}"
run git tag -a "v${VERSION}" -m "v${VERSION}"

if [[ "$PUSH" -eq 1 ]]; then
  if [[ "$PUBLISH_CONTAINER" -eq 1 ]]; then
    if [[ "$EXPORT_OFFLINE_IMAGE" -eq 1 ]]; then
      run bash scripts/publish_container_local.sh --version "$VERSION" --export-offline-images
    else
      run bash scripts/publish_container_local.sh --version "$VERSION"
    fi
  fi
  run git push origin main
  run git push origin "v${VERSION}"
  run bash scripts/upload_release_package_local.sh --version "$VERSION" --package "$OFFLINE_PACKAGE_PATH"
  run bash scripts/sync_wiki_local.sh
fi
