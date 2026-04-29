#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT}/package.json').version")"
OUT_DIR="${ROOT}/dist"
PACKAGE_NAME="CageLedger-offline-v${VERSION}.tar.gz"

mkdir -p "${OUT_DIR}"
rm -f "${OUT_DIR}/${PACKAGE_NAME}"

tar \
  --exclude=".git" \
  --exclude="data" \
  --exclude="dist" \
  --exclude="__pycache__" \
  --exclude=".DS_Store" \
  --exclude="src/iacuc-data.local.json" \
  -czf "${OUT_DIR}/${PACKAGE_NAME}" \
  -C "$(dirname "${ROOT}")" \
  "$(basename "${ROOT}")"

echo "${OUT_DIR}/${PACKAGE_NAME}"
