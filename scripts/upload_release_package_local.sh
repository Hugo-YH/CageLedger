#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/upload_release_package_local.sh --version 0.7.6 --package /absolute/path/to/CageLedger-offline-v0.7.6.tar.gz

Options:
  --version <ver>    Release version without the v prefix.
  --package <path>   Local offline package to upload.

Authentication:
  Uses CAGELEDGER_GITEA_TOKEN when set. Otherwise reads the HTTPS credential
  already configured for the origin remote through git credential fill.
EOF
}

VERSION=""
PACKAGE_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --package)
      PACKAGE_PATH="${2:-}"
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

if [[ -z "$VERSION" ]] || [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.-]*$ ]]; then
  echo "Release version must look like 0.7.6 or 0.7.6a." >&2
  exit 1
fi

if [[ -z "$PACKAGE_PATH" ]] || [[ ! -f "$PACKAGE_PATH" ]]; then
  echo "A readable --package path is required." >&2
  exit 1
fi

cd "$ROOT"

ORIGIN_URL="$(git remote get-url origin)"
REPOSITORY="${CAGELEDGER_GITEA_REPOSITORY:-}"
GITEA_URL="${CAGELEDGER_GITEA_URL:-}"

if [[ -z "$REPOSITORY" ]]; then
  case "$ORIGIN_URL" in
    http://*|https://*)
      REPOSITORY="$(printf '%s' "$ORIGIN_URL" | sed -E 's#^https?://[^/]+/##; s#\.git$##')"
      ;;
    *@*:*)
      REPOSITORY="$(printf '%s' "$ORIGIN_URL" | sed -E 's#^[^:]+:##; s#\.git$##')"
      ;;
    *)
      echo "Unable to derive the Gitea repository from origin: $ORIGIN_URL" >&2
      exit 1
      ;;
  esac
fi

if [[ -z "$GITEA_URL" ]]; then
  case "$ORIGIN_URL" in
    http://*|https://*)
      GITEA_URL="$(printf '%s' "$ORIGIN_URL" | sed -E 's#^(https?://[^/]+).*#\1#')"
      ;;
    *@*:*)
      GITEA_HOST="$(printf '%s' "$ORIGIN_URL" | sed -E 's#^[^@]+@([^:]+):.*#\1#')"
      GITEA_URL="https://${GITEA_HOST}"
      ;;
  esac
fi

if [[ -z "$GITEA_URL" ]]; then
  echo "Set CAGELEDGER_GITEA_URL when the Gitea server cannot be derived from origin." >&2
  exit 1
fi

API_BASE="${GITEA_URL%/}/api/v1"
AUTH_ARGS=()

if [[ -n "${CAGELEDGER_GITEA_TOKEN:-}" ]]; then
  AUTH_ARGS=(-H "Authorization: token ${CAGELEDGER_GITEA_TOKEN}")
else
  GITEA_HOST="$(printf '%s' "$GITEA_URL" | sed -E 's#^https?://([^/]+).*#\1#')"
  CREDENTIAL_INPUT=$'protocol=https\n'
  CREDENTIAL_INPUT+="host=${GITEA_HOST}"$'\n'
  CREDENTIAL_INPUT+="path=${REPOSITORY}"$'\n\n'
  CREDENTIAL="$(printf '%s' "$CREDENTIAL_INPUT" | git credential fill)"
  CREDENTIAL_USERNAME="$(printf '%s\n' "$CREDENTIAL" | sed -n 's/^username=//p')"
  CREDENTIAL_PASSWORD="$(printf '%s\n' "$CREDENTIAL" | sed -n 's/^password=//p')"
  if [[ -z "$CREDENTIAL_USERNAME" ]] || [[ -z "$CREDENTIAL_PASSWORD" ]]; then
    echo "Set CAGELEDGER_GITEA_TOKEN or configure an HTTPS credential for ${GITEA_HOST}." >&2
    exit 1
  fi
  AUTH_ARGS=(-u "${CREDENTIAL_USERNAME}:${CREDENTIAL_PASSWORD}")
fi

TAG="v${VERSION}"
RELEASE_FILE="$(mktemp)"
cleanup() {
  rm -f "$RELEASE_FILE"
}
trap cleanup EXIT

HTTP_CODE="$(curl -sS -o "$RELEASE_FILE" -w '%{http_code}' "${AUTH_ARGS[@]}" \
  "${API_BASE}/repos/${REPOSITORY}/releases/tags/${TAG}")"
if [[ "$HTTP_CODE" = "200" ]]; then
  RELEASE_JSON="$(cat "$RELEASE_FILE")"
  EXISTING_RELEASE_ID="$(printf '%s' "$RELEASE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
  RELEASE_JSON="$(curl -fsS -X PATCH "${AUTH_ARGS[@]}" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"CageLedger ${TAG}\"}" \
    "${API_BASE}/repos/${REPOSITORY}/releases/${EXISTING_RELEASE_ID}")"
elif [[ "$HTTP_CODE" = "404" ]]; then
  RELEASE_JSON="$(curl -fsS -X POST "${AUTH_ARGS[@]}" \
    -H 'Content-Type: application/json' \
    -d "{\"tag_name\":\"${TAG}\",\"name\":\"CageLedger ${TAG}\"}" \
    "${API_BASE}/repos/${REPOSITORY}/releases")"
else
  cat "$RELEASE_FILE" >&2
  echo "Unable to load Gitea Release for ${TAG}: HTTP ${HTTP_CODE}" >&2
  exit 1
fi

RELEASE_ID="$(printf '%s' "$RELEASE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
PACKAGE_NAME="$(basename "$PACKAGE_PATH")"
ASSETS_JSON="$(curl -fsS "${AUTH_ARGS[@]}" \
  "${API_BASE}/repos/${REPOSITORY}/releases/${RELEASE_ID}/assets")"
ASSET_ID="$(printf '%s' "$ASSETS_JSON" | python3 -c 'import json,sys; name=sys.argv[1]; print(next((item["id"] for item in json.load(sys.stdin) if item.get("name") == name), ""))' "$PACKAGE_NAME")"

if [[ -n "$ASSET_ID" ]]; then
  echo "Release ${TAG} already contains ${PACKAGE_NAME}; keeping the immutable asset."
  exit 0
fi

curl -fsS -X POST "${AUTH_ARGS[@]}" \
  -F "attachment=@${PACKAGE_PATH}" \
  "${API_BASE}/repos/${REPOSITORY}/releases/${RELEASE_ID}/assets?name=${PACKAGE_NAME}" >/dev/null

echo "Uploaded ${PACKAGE_NAME} to ${GITEA_URL%/}/${REPOSITORY}/releases/tag/${TAG}"
