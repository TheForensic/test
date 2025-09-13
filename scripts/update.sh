#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="autobridgebot"
INSTALL_DIR="/opt/AutoBridgeBot"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

cd "$INSTALL_DIR"
echo "[Repo] Pulling latest..."
git pull --rebase
echo "[NPM] Installing/updating dependencies..."
if [[ -f package-lock.json ]]; then
  npm ci || npm install
else
  npm install
fi
echo "[Systemd] Restarting service..."
systemctl restart "$SERVICE_NAME"
systemctl status --no-pager "$SERVICE_NAME" || true

if [[ -f .env ]]; then
  echo "[Env] Current schedule settings:"
  grep -E '^(CRON_SCHEDULE|INTERVAL_HOURS|DISABLE_INTERNAL_CRON)=' .env || true
  echo "(To change schedule, edit /opt/AutoBridgeBot/.env or re-run the installer and overwrite .env.)"
fi
