#!/usr/bin/env bash
# Linux cloud jobs use the managed socket; macOS uses its local Desktop/Colima context.
docker_local() {
  if [[ "$(uname -s)" == Darwin ]]; then
    local cageledger_endpoint cageledger_context
    if [[ -n "${DOCKER_CONTEXT:-}" ]]; then
      cageledger_context="$DOCKER_CONTEXT"
      cageledger_endpoint="$(docker context inspect "$cageledger_context" --format '{{.Endpoints.docker.Host}}')" || return
    elif [[ -n "${DOCKER_HOST:-}" ]]; then
      cageledger_endpoint="$DOCKER_HOST"
    else
      cageledger_context="$(docker context show)" || return
      cageledger_endpoint="$(docker context inspect "$cageledger_context" --format '{{.Endpoints.docker.Host}}')" || return
    fi
    if [[ "$cageledger_endpoint" != unix:///* ]]; then
      echo "CageLedger builds require a local Docker Desktop or Colima Unix socket" >&2
      return 1
    fi
    command docker "$@"
  else
    env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
      docker --host=unix:///var/run/docker.sock "$@"
  fi
}
