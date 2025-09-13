#!/usr/bin/env bash
set -euo pipefail

REPO_URL_DEFAULT="https://github.com/YrustPd/AutoBridgeBot.git"
INSTALL_DIR="/opt/AutoBridgeBot"
SERVICE_NAME="autobridgebot"
ENV_FILE="${INSTALL_DIR}/.env"

echo "=== AutoBridgeBot installer ==="

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

read -r -p "Git repository URL [${REPO_URL_DEFAULT}]: " REPO_URL
REPO_URL=${REPO_URL:-$REPO_URL_DEFAULT}

pkg_install() {
  local pkg="$1"
  (command -v apt >/dev/null 2>&1 && apt update && apt install -y "$pkg") || \
  (command -v dnf >/dev/null 2>&1 && dnf install -y "$pkg") || \
  (command -v yum >/dev/null 2>&1 && yum install -y "$pkg") || \
  (command -v apk >/dev/null 2>&1 && apk add --no-cache "$pkg") || true
}

command -v curl >/dev/null 2>&1 || pkg_install curl
command -v git >/dev/null 2>&1 || pkg_install git

ensure_node_latest() {
  echo "[Node] Ensuring latest LTS Node.js..."
  if command -v apt >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash -
    dnf install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash -
    yum install -y nodejs
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache nodejs npm
  else
    echo "[Node] Unsupported package manager; install manually." >&2
  fi
}

ensure_git_latest() {
  echo "[Git] Ensuring Git is installed/up-to-date..."
  if command -v apt >/dev/null 2>&1; then
    apt update && apt install -y git
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y git
  elif command -v yum >/dev/null 2>&1; then
    yum install -y git
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache git
  else
    echo "[Git] Unsupported package manager; install manually." >&2
  fi
}

ensure_git_latest
ensure_node_latest

if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "[Repo] Existing clone in $INSTALL_DIR"
  CUR_ORIGIN=$(git -C "$INSTALL_DIR" remote get-url origin || true)
  if [[ "$CUR_ORIGIN" != "$REPO_URL" ]]; then
    echo "[Repo] Origin differs:"
    echo "  current: $CUR_ORIGIN"
    echo "  desired: $REPO_URL"
    read -r -p "Switch origin? (Y) or Reclone? (r) [Y/r]: " ORIG
    ORIG=${ORIG:-Y}
    if [[ "$ORIG" =~ ^[Rr]$ ]]; then
      rm -rf "$INSTALL_DIR"
      git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
    else
      git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL"
    fi
  fi
  echo "[Repo] Updating..."
  git -C "$INSTALL_DIR" -c credential.helper= fetch --prune --depth=1
  git -C "$INSTALL_DIR" reset --hard FETCH_HEAD
else
  echo "[Repo] Cloning into $INSTALL_DIR ..."
  rm -rf "$INSTALL_DIR"
  git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
echo "[NPM] Installing/updating dependencies..."
if [[ -f package-lock.json ]]; then
  if ! npm ci; then
    echo "[NPM] npm ci failed; falling back to npm install"
    npm install || true
  fi
else
  npm install || true
fi

EXISTS_ENV=0
if [[ -f "$ENV_FILE" ]]; then
  EXISTS_ENV=1
  echo "[Env] Existing .env found at $ENV_FILE"
fi

if [[ ${MODE:-} != "" ]]; then
  OW="y"
elif [[ $EXISTS_ENV -eq 1 ]]; then
  read -r -p "Overwrite existing .env? [y/N]: " OW
  OW=${OW:-N}
else
  OW="y"
fi

rand_port() {
  # find free port in 20000-39999, auto-increment if in use
  local p=${1:-}
  if [[ -z "$p" ]]; then p=$(( (RANDOM % 20000) + 20000 )); fi
  while true; do
    if ! ss -ltn | awk '{print $4}' | grep -q ":$p$"; then echo "$p"; return; fi
    p=$((p+1)); if [[ $p -gt 39999 ]]; then p=20000; fi
  done
}

prompt_nonempty() {
  local val=""; local prompt="$1"
  if [[ -n "${TOKEN:-}" && "$prompt" == "Telegram Bot Token: " ]]; then echo "$TOKEN"; return; fi
  if [[ -n "${CHAT_ID:-}" && "$prompt" == "Telegram Chat ID: " ]]; then echo "$CHAT_ID"; return; fi
  while [[ -z "$val" ]]; do read -r -p "$prompt" val; done; echo "$val"
}

declare -A envmap
if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r k v; do [[ -n "$k" ]] && envmap[$k]="$v"; done < "$ENV_FILE"
fi

if [[ "$OW" =~ ^[Yy]$ ]]; then
  TELEGRAM_BOT_TOKEN=$(prompt_nonempty "Telegram Bot Token: ")
  TELEGRAM_CHAT_ID=$(prompt_nonempty "Telegram Chat ID: ")
  BIND_HOST=${BIND_HOST:-${envmap[BIND_HOST]:-0.0.0.0}}
  if [[ -z "${PORT:-}" ]]; then read -r -p "HTTP port (blank=random 20000-39999): " PORT || true; fi
  PORT=$(rand_port "$PORT")

  if [[ "${MODE:-}" == "daily" ]]; then
    HHMM=${DAILY:-""}
  elif [[ "${MODE:-}" == "hours" ]]; then
    N=${HOURSM:-""}
  else
    echo "Select scheduling mode:"; echo "  1) Daily at specific time (HH:MM)"; echo "  2) Every N hours";
    read -r -p "Choice [1/2]: " CH; CH=${CH:-1}
    if [[ "$CH" == "1" ]]; then MODE="daily"; else MODE="hours"; fi
  fi

  CRON_SCHEDULE=""; INTERVAL_HOURS=""
  if [[ "$MODE" == "daily" ]]; then
    while true; do
      if [[ -z "${HHMM:-}" ]]; then read -r -p "Time (HH:MM, 24h): " HHMM; fi
      if [[ "$HHMM" =~ ^([0-1][0-9]|2[0-3]):([0-5][0-9])$ ]]; then HH=${BASH_REMATCH[1]}; MM=${BASH_REMATCH[2]}; CRON_SCHEDULE="$MM $HH * * *"; break; fi
      echo "Invalid time format"; HHMM="";
    done
  else
    while true; do
      if [[ -z "${N:-}" ]]; then read -r -p "Every N hours (>=1) [12]: " N; N=${N:-12}; fi
      if [[ "$N" =~ ^[0-9]+$ ]] && [[ "$N" -ge 1 ]]; then INTERVAL_HOURS="$N"; break; fi
      echo "Invalid hours"; N="";
    done
  fi
  # disable toggle
  if [[ -z "${DISABLE_INTERNAL_CRON:-}" ]]; then read -r -p "Disable internal cron? (true/false) [false]: " DISABLE_INTERNAL_CRON || true; fi

  ADMIN_USER="admin"
  ADMIN_PASS=${ADMIN_PASS:-${envmap[ADMIN_PASS]:-$(tr -dc 'A-Za-z0-9!@#%&*' < /dev/urandom | head -c 24)}}
  JWT_SECRET=${JWT_SECRET:-${envmap[JWT_SECRET]:-$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48)}}

  echo "[Env] Writing $ENV_FILE ..."
  cat > "$ENV_FILE" <<EOF
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
BIND_HOST=${BIND_HOST}
PORT=${PORT}
CRON_SCHEDULE=${CRON_SCHEDULE}
INTERVAL_HOURS=${INTERVAL_HOURS}
DISABLE_INTERNAL_CRON=${DISABLE_INTERNAL_CRON}
ADMIN_USER=${ADMIN_USER}
ADMIN_PASS=${ADMIN_PASS}
JWT_SECRET=${JWT_SECRET}
NODE_ENV=production
EOF
else
  echo "[Env] Merging defaults into existing $ENV_FILE"
  # ensure required keys exist with defaults
  envmap[TELEGRAM_BOT_TOKEN]="${envmap[TELEGRAM_BOT_TOKEN]:-}"
  envmap[TELEGRAM_CHAT_ID]="${envmap[TELEGRAM_CHAT_ID]:-}"
  envmap[BIND_HOST]="${envmap[BIND_HOST]:-0.0.0.0}"
  # ensure usable port
  P_CUR="${envmap[PORT]:-}"
  envmap[PORT]=$(rand_port "$P_CUR")
  envmap[CRON_SCHEDULE]="${envmap[CRON_SCHEDULE]:-}"
  envmap[INTERVAL_HOURS]="${envmap[INTERVAL_HOURS]:-12}"
  envmap[DISABLE_INTERNAL_CRON]="${envmap[DISABLE_INTERNAL_CRON]:-}"
  envmap[ADMIN_USER]="${envmap[ADMIN_USER]:-admin}"
  envmap[ADMIN_PASS]="${envmap[ADMIN_PASS]:-$(tr -dc 'A-Za-z0-9!@#%&*' < /dev/urandom | head -c 24)}"
  envmap[JWT_SECRET]="${envmap[JWT_SECRET]:-$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48)}"
  {
    for k in TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID BIND_HOST PORT CRON_SCHEDULE INTERVAL_HOURS DISABLE_INTERNAL_CRON ADMIN_USER ADMIN_PASS JWT_SECRET NODE_ENV; do
      v="${envmap[$k]:-}"; [[ "$k" == "NODE_ENV" && -z "$v" ]] && v=production; echo "$k=$v";
    done
  } > "$ENV_FILE"
fi

echo "[Systemd] Creating/updating service..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=AutoBridgeBot HTTP server
After=network.target

[Service]
Type=simple
EnvironmentFile=${ENV_FILE}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"

# CLI symlink
ln -sf "${INSTALL_DIR}/bin/atb-cli" /usr/local/bin/atb-cli || true

PUB_IP=$(curl -s4 https://ifconfig.co || true)
if [[ -z "$PUB_IP" ]]; then PUB_IP=$(hostname -I 2>/dev/null | awk '{print $1}'); fi
echo "=== Install/Upgrade complete ==="
echo "Service: ${SERVICE_NAME}  (systemctl status ${SERVICE_NAME})"
echo "Health:  http://${PUB_IP}:$(grep '^PORT=' "$ENV_FILE"|cut -d= -f2-)/health"
echo "Panel:   http://${PUB_IP}:$(grep '^PORT=' "$ENV_FILE"|cut -d= -f2-)/panel"
echo "Run now: curl -X POST http://${PUB_IP}:$(grep '^PORT=' "$ENV_FILE"|cut -d= -f2-)/run"
echo
echo "Login  → user: admin"
echo "Password: $(grep '^ADMIN_PASS=' "$ENV_FILE"|cut -d= -f2-)"
echo
echo "Schedule:"
echo "  CRON_SCHEDULE=\"$(grep '^CRON_SCHEDULE=' "$ENV_FILE"|cut -d= -f2-)\""
echo "  INTERVAL_HOURS=\"$(grep '^INTERVAL_HOURS=' "$ENV_FILE"|cut -d= -f2-)\""
