#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_NAME="$(basename "${ROOT}")"
VERSION="$(node -p "require('${ROOT}/package.json').version")"
OUT_DIR="${ROOT}/dist"
PACKAGE_NAME="CageLedger-offline-${VERSION}.tar.gz"

cd "${ROOT}"
npm run build >/dev/null

mkdir -p "${OUT_DIR}"
rm -f "${OUT_DIR}/${PACKAGE_NAME}"

tar \
  --exclude=".git" \
  --exclude=".gitea" \
  --exclude=".github" \
  --exclude=".codex" \
  --exclude=".codex-run" \
  --exclude=".env" \
  --exclude="data" \
  --exclude="dist" \
  --exclude="${ROOT_NAME}/docs" \
  --exclude="node_modules" \
  --exclude=".vite" \
  --exclude="playwright-report" \
  --exclude="test-results" \
  --exclude="tests" \
  --exclude="playwright.config.ts" \
  --exclude="src/test" \
  --exclude="*.test.ts" \
  --exclude="*.test.tsx" \
  --exclude="__pycache__" \
  --exclude=".DS_Store" \
  --exclude="src/iacuc-data.local.json" \
  -czf "${OUT_DIR}/${PACKAGE_NAME}" \
  -C "$(dirname "${ROOT}")" \
  "${ROOT_NAME}"

if ! tar -tzf "${OUT_DIR}/${PACKAGE_NAME}" \
  "${ROOT_NAME}/web-dist/index.html" \
  "${ROOT_NAME}/web-dist/docs/index.html" >/dev/null; then
  echo "Offline package is missing its application or built documentation entry." >&2
  exit 1
fi

echo "${OUT_DIR}/${PACKAGE_NAME}"
