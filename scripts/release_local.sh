#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
RELEASE_NODE="${CAGELEDGER_NODE_BIN:-$(command -v node)}"
node_supported() {
  "$1" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 22 && minor >= 12 ? 0 : 1)'
}
if [[ -z "${CAGELEDGER_NODE_BIN:-}" ]] && ! node_supported "$RELEASE_NODE"; then
  RELEASE_NODE="${HOME}/.local/share/cageledger-node22/bin/node"
fi
if [[ ! -x "$RELEASE_NODE" ]] || ! node_supported "$RELEASE_NODE"; then
  echo "Release requires Node >=22.12 <23; set CAGELEDGER_NODE_BIN to an existing Node 22 executable." >&2
  exit 1
fi
PATH="$(dirname "$RELEASE_NODE"):$PATH"
export PATH
exec "$RELEASE_NODE" scripts/run_python.mjs scripts/release_pipeline.py "$@"
