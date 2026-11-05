#!/usr/bin/env bash
set -euo pipefail

# BuildKit secrets are mounted only for this RUN; temporary trust configuration
# is deleted before the layer is committed. Do not COPY session CAs into images.
build_ca_directory=""
cleanup_build_ca() {
  if [[ -n "$build_ca_directory" ]]; then rm -rf "$build_ca_directory"; fi
}
trap cleanup_build_ca EXIT

if [[ -f /run/secrets/ca_bundle || -f /run/secrets/proxy_ca ]]; then
  build_ca_directory="$(mktemp -d /tmp/cageledger-build-ca-XXXXXX)"
  if [[ -f /run/secrets/ca_bundle ]]; then
    cp /run/secrets/ca_bundle "$build_ca_directory/ca-bundle.pem"
  else
    cp /etc/ssl/certs/ca-certificates.crt "$build_ca_directory/ca-bundle.pem"
  fi
  if [[ -f /run/secrets/proxy_ca ]]; then cat /run/secrets/proxy_ca >>"$build_ca_directory/ca-bundle.pem"; fi
  export SSL_CERT_FILE="$build_ca_directory/ca-bundle.pem"
  export REQUESTS_CA_BUNDLE="$SSL_CERT_FILE"
  export PIP_CERT="$SSL_CERT_FILE"
  export CURL_CA_BUNDLE="$SSL_CERT_FILE"
  export npm_config_cafile="$SSL_CERT_FILE"
  if [[ -f /run/secrets/proxy_ca ]]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi
  printf 'Acquire::https::CaInfo "%s";\n' "$SSL_CERT_FILE" >"$build_ca_directory/apt.conf"
  # APT drops privileges to _apt for HTTPS downloads; CA certificates are public.
  chmod 755 "$build_ca_directory"
  chmod 644 "$SSL_CERT_FILE" "$build_ca_directory/apt.conf"
  export APT_CONFIG="$build_ca_directory/apt.conf"
fi

"$@"
