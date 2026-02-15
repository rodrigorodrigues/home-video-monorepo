#!/usr/bin/env bash
# Purpose: validate/install base Raspberry Pi dependencies in sequence
# (git first, then runtime packages like Docker, rclone, and compose plugin).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
API_DIR="$REPO_ROOT/apps/api"
SECRET_DIR="$REPO_ROOT/secrets"
SECRET_FILE="$SECRET_DIR/admin_password_hash"

INSTALL_MISSING="${INSTALL_MISSING:-false}"
RETRY_MAX="${RETRY_MAX:-3}"
RETRY_DELAY_SECONDS="${RETRY_DELAY_SECONDS:-5}"

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run as your normal user (not root). This script will use sudo when required."
  exit 1
fi

echo "Running pre-install checks..."
require_cmd sudo
require_cmd apt-get
require_cmd dpkg
require_cmd systemctl
require_cmd grep

# Install order is explicit: git first, then the rest.
PACKAGES=(
  "git"
  "ca-certificates"
  "curl"
  "fuse3"
  "rclone"
  "docker.io"
  "docker-compose-plugin"
)

MISSING=()

is_pkg_installed() {
  local pkg="$1"
  dpkg -s "$pkg" >/dev/null 2>&1
}

install_pkg() {
  local pkg="$1"
  echo "Installing missing package: $pkg"
  retry "$RETRY_MAX" "$RETRY_DELAY_SECONDS" sudo apt-get install -y "$pkg"
}

echo "Refreshing apt index..."
retry "$RETRY_MAX" "$RETRY_DELAY_SECONDS" sudo apt-get update

for pkg in "${PACKAGES[@]}"; do
  if is_pkg_installed "$pkg"; then
    echo "[ok] $pkg"
    continue
  fi

  echo "[missing] $pkg"
  MISSING+=("$pkg")
  if [[ "$INSTALL_MISSING" == "true" ]]; then
    install_pkg "$pkg"
  fi
done

if [[ "${#MISSING[@]}" -gt 0 && "$INSTALL_MISSING" != "true" ]]; then
  echo
  echo "Missing packages found. Re-run with INSTALL_MISSING=true to install in order."
  printf 'Missing: %s\n' "${MISSING[*]}"
  exit 1
fi

echo "Verifying runtime commands..."
require_cmd git
require_cmd rclone
require_cmd docker

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin is not available."
  exit 1
fi

if ! systemctl list-unit-files | grep -q "^docker.service"; then
  echo "docker.service is not present after installation."
  exit 1
fi

echo "Validating prod mount prerequisites..."
if [[ ! -d "/mnt" ]]; then
  echo "Missing /mnt on host."
  echo "Prod profile expects mounted storage under /mnt."
  exit 1
fi

mkdir -p "$SECRET_DIR"
if [[ ! -s "$SECRET_FILE" ]]; then
  if [[ -z "${ADMIN_PASSWORD_PLAIN:-}" ]]; then
    echo "Missing secret file: $SECRET_FILE"
    echo "Set ADMIN_PASSWORD_PLAIN to generate it automatically."
    echo 'Example: ADMIN_PASSWORD_PLAIN="change-me" ./scripts/pi/preinstall-check.sh'
    exit 1
  fi

  require_cmd npm
  if [[ ! -d "$API_DIR/node_modules/bcrypt" ]]; then
    echo "Installing API dependencies (required for hash generation)..."
    retry "$RETRY_MAX" "$RETRY_DELAY_SECONDS" npm --prefix "$API_DIR" ci
  fi

  echo "Generating bcrypt hash into $SECRET_FILE..."
  HASH="$(npm --prefix "$API_DIR" run -s hash:password -- "$ADMIN_PASSWORD_PLAIN" | tr -d '\r')"
  if [[ -z "$HASH" ]]; then
    echo "Hash generation returned empty output."
    exit 1
  fi

  umask 077
  printf "%s\n" "$HASH" > "$SECRET_FILE"
fi

if ! grep -Eq '^\$2[aby]\$[0-9]{2}\$' "$SECRET_FILE"; then
  echo "Invalid bcrypt hash format in $SECRET_FILE"
  echo 'Regenerate with: npm --prefix apps/api run hash:password -- "<password>"'
  exit 1
fi

echo "Pre-install check completed successfully."
