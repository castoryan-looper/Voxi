#!/usr/bin/env bash
set -Eeuo pipefail
root=${1:?repository required}
revision=${2:-HEAD}
config=${3:-/etc/voxi}
# Firmware, docs and backup changes do not alter the running cloud service.
{
  git -C "$root" ls-tree -r "$revision" -- Dockerfile .dockerignore gateway compose.yaml compose.pocket.yaml deploy
  for file in gateway.env deploy.env pocket.enabled tls/ca.crt tls/server.crt tls/server.key; do
    printf '%s\n' "$file"
    if [[ -f "$config/$file" ]]; then sha256sum < "$config/$file"; else printf 'missing\n';fi
  done
} | sha256sum | cut -d ' ' -f1
