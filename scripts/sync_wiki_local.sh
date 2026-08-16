#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/sync_wiki_local.sh

Authentication:
  Uses CAGELEDGER_GITEA_TOKEN when set. Otherwise uses the configured Git
  credentials for the origin remote.
EOF
}

if [[ "${1:-}" = "-h" || "${1:-}" = "--help" ]]; then
  usage
  exit 0
fi

origin_url="$(git -C "$ROOT" remote get-url --push origin)"
gitea_url="${CAGELEDGER_GITEA_URL:-}"
repository="${CAGELEDGER_GITEA_REPOSITORY:-}"

if [[ -z "$repository" ]]; then
  case "$origin_url" in
    http://*|https://*)
      repository="$(printf '%s' "$origin_url" | sed -E 's#^https?://[^/]+/##; s#\.git$##')"
      ;;
    *@*:*)
      repository="$(printf '%s' "$origin_url" | sed -E 's#^[^:]+:##; s#\.git$##')"
      ;;
    *)
      echo "Unable to derive the Gitea repository from origin: $origin_url" >&2
      exit 1
      ;;
  esac
fi

if [[ -z "$gitea_url" ]]; then
  case "$origin_url" in
    http://*|https://*)
      gitea_url="$(printf '%s' "$origin_url" | sed -E 's#^(https?://[^/]+).*#\1#')"
      ;;
    *@*:*)
      gitea_host="$(printf '%s' "$origin_url" | sed -E 's#^[^@]+@([^:]+):.*#\1#')"
      gitea_url="https://${gitea_host}"
      ;;
  esac
fi

if [[ -z "$gitea_url" ]]; then
  echo "Set CAGELEDGER_GITEA_URL when the Gitea server cannot be derived from origin." >&2
  exit 1
fi

git_args=()
if [[ -n "${CAGELEDGER_GITEA_TOKEN:-}" ]]; then
  git_args=(-c "http.extraHeader=Authorization: token ${CAGELEDGER_GITEA_TOKEN}")
fi

workspace="$(mktemp -d)"
cleanup() {
  rm -rf "$workspace"
}
trap cleanup EXIT

wiki_url="${gitea_url%/}/${repository}.wiki.git"
target="$workspace/wiki"
documentation_url="${CAGELEDGER_DOCUMENTATION_URL:-https://cl.cellnucle.us/docs}"

if ! git "${git_args[@]+"${git_args[@]}"}" clone --depth 1 "$wiki_url" "$target"; then
  echo "Unable to clone the Gitea Wiki. Create the Wiki once in Gitea, then retry." >&2
  exit 1
fi

find "$target" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$ROOT/wiki-redirect/." "$target/"

while IFS= read -r source; do
  page_name="$(basename "$source")"
  if [[ "$page_name" = "Home.md" ]]; then
    continue
  fi
  cat >"$target/$page_name" <<EOF
# 文档已迁移

本页内容已迁移到 CageLedger VitePress 文档站。

[打开当前文档](${documentation_url%/}/)
EOF
done < <(find "$ROOT/wiki" -maxdepth 1 -type f -name '*.md' -print)

git -C "$target" config user.name "cageledger-release"
git -C "$target" config user.email "release@cellnucle.us"

if [[ -z "$(git -C "$target" status --porcelain)" ]]; then
  echo "Gitea Wiki already exposes the VitePress migration entry."
  exit 0
fi

git -C "$target" add .
git -C "$target" commit -m "docs: update VitePress migration entry from $(git -C "$ROOT" rev-parse --short HEAD)"
git -C "$target" "${git_args[@]+"${git_args[@]}"}" push origin HEAD:main

echo "Updated Gitea Wiki migration pages at ${gitea_url%/}/${repository}/wiki"
