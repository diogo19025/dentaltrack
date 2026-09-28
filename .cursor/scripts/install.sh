#!/usr/bin/env bash
# Dependências do ambiente local: pacotes do sistema, binário do GoTrue e node_modules.
# Idempotente. Não sobe serviço — isso é o start.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

GOTRUE_VERSION="v2.197.0"
GOTRUE_SHA256="b5c2991d1df760c9b099c1c2395a94bd1c2f83ed58901934921997179dc9f7ea"
GOTRUE_DIR="/opt/dentaltrack/gotrue"
GOTRUE_URL="https://github.com/supabase/auth/releases/download/${GOTRUE_VERSION}/auth-${GOTRUE_VERSION}-amd64.tar.xz"

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq postgresql postgresql-contrib nginx xz-utils ca-certificates curl

if ! "${GOTRUE_DIR}/auth" version 2>/dev/null | grep -qx "${GOTRUE_VERSION}"; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "${tmp}/auth.tar.xz" "$GOTRUE_URL"
  echo "${GOTRUE_SHA256}  ${tmp}/auth.tar.xz" | sha256sum -c -
  tar -xJf "${tmp}/auth.tar.xz" -C "$tmp"
  sudo mkdir -p "$GOTRUE_DIR"
  sudo rm -rf "${GOTRUE_DIR}/migrations"
  sudo cp "$tmp/auth" "${GOTRUE_DIR}/auth"
  sudo cp -a "$tmp/migrations" "${GOTRUE_DIR}/migrations"
  sudo chown -R ubuntu:ubuntu /opt/dentaltrack
  sudo chmod 755 "${GOTRUE_DIR}/auth"
  rm -rf "$tmp"
  trap - EXIT
fi

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@11.5.1 --activate
fi

pnpm install --frozen-lockfile
pnpm --filter @dentaltrack/shared build
