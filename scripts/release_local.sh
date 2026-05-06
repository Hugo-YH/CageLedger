#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/release_local.sh --version 0.4.1 [--push] [--dry-run]
  bash scripts/release_local.sh 0.4.1 [--push] [--dry-run]

Options:
  --version <ver>  Release version, for example 0.4.1 or 0.4.0a
  --push           Push main and the new v<version> tag after commit/tag
  --dry-run        Print steps without executing them
EOF
}

VERSION=""
PUSH=0
DRY_RUN=0

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

if [[ -n "$(git status --short)" ]]; then
  echo "Release script expects a clean working tree. Commit or stash current changes first." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/v${VERSION}" >/dev/null; then
  echo "Local tag v${VERSION} already exists." >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/v${VERSION}" >/dev/null 2>&1; then
  echo "Remote tag v${VERSION} already exists on origin." >&2
  exit 1
fi

run node scripts/set_version.mjs --version "$VERSION"

MATCH_COUNT="$(rg -c "version: \"${VERSION}\"" src/app.js || true)"
if [[ "${MATCH_COUNT:-0}" -lt 2 ]]; then
  echo "src/app.js is missing a dedicated ${VERSION} entry in SYSTEM_RELEASE_NOTES. Update release notes first." >&2
  exit 1
fi

run npm run check
run npm run package:offline
run git add -A
run git commit -m "Release v${VERSION}"
run git tag -a "v${VERSION}" -m "v${VERSION}"

if [[ "$PUSH" -eq 1 ]]; then
  run git push origin main
  run git push origin "v${VERSION}"
fi
