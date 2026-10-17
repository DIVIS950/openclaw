#!/usr/bin/env bash
# Muse installer: turns a fresh Ubuntu or Debian server (for example a Hetzner Cloud VPS) into your
# own always-on AI computer: OpenClaw with Claude, a cloud desktop you can watch, WhatsApp/Telegram,
# a private web page, and the Muse Sentinel guard.
#
# Run as root on the server:
#   curl -fsSL https://raw.githubusercontent.com/divis950/openclaw/muse-cloud/deploy/muse/install.sh | bash
# or, from a checkout:
#   sudo ./deploy/muse/install.sh
#
# Answers can be given ahead of time as environment variables (then nothing is asked):
#   ANTHROPIC_API_KEY, MUSE_DOMAIN, TELEGRAM_BOT_TOKEN, MUSE_TELEGRAM_OWNER, MUSE_WHATSAPP_OWNER,
#   MUSE_REPO, MUSE_BRANCH, MUSE_MODEL, MUSE_YES=1 (accept defaults without asking).
set -euo pipefail

MUSE_REPO="${MUSE_REPO:-https://github.com/divis950/openclaw.git}"
MUSE_BRANCH="${MUSE_BRANCH:-muse-cloud}"
MUSE_HOME="${MUSE_HOME:-/opt/muse}"
MUSE_DATA_DIR="${MUSE_DATA_DIR:-/srv/muse}"
MUSE_ENV_FILE="${MUSE_ENV_FILE:-$MUSE_DATA_DIR/muse.env}"
MUSE_SKIP_SYSTEM="${MUSE_SKIP_SYSTEM:-0}"   # 1 = do not install packages or touch the firewall (tests)
MUSE_SKIP_START="${MUSE_SKIP_START:-0}"     # 1 = write config only, do not build or start (tests)

say() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;31m!!\033[0m %s\n' "$*" >&2; }
die() { warn "$*"; exit 1; }

ask() {
  # ask VAR "Question" "default" [secret]
  local var="$1" question="$2" default="${3:-}" secret="${4:-}" answer=""
  if [ -n "${!var:-}" ]; then return; fi
  if [ "${MUSE_YES:-0}" = "1" ] || ! { : </dev/tty; } 2>/dev/null; then
    # No way to ask (unattended run): take the default.
    printf -v "$var" '%s' "$default"; return
  fi
  if [ -n "$secret" ]; then
    read -r -s -p "$question: " answer </dev/tty || answer=""
    echo
  else
    read -r -p "$question${default:+ [$default]}: " answer </dev/tty || answer=""
  fi
  printf -v "$var" '%s' "${answer:-$default}"
}

rand_hex() { openssl rand -hex "$1"; }

require_root() {
  [ "$(id -u)" = "0" ] || die "Run this as root (sudo -i first)."
}

install_system() {
  [ "$MUSE_SKIP_SYSTEM" = "1" ] && return
  say "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git openssl python3 qrencode ufw >/dev/null
  if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
    say "Installing Docker"
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true

  say "Opening the firewall for SSH, HTTP and HTTPS only"
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
}

fetch_code() {
  # Use the checkout this script lives in when there is one; otherwise clone.
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
  if [ -n "$here" ] && [ -f "$here/docker-compose.yml" ] && [ -f "$here/../../Dockerfile" ]; then
    MUSE_CODE_DIR="$(cd "$here/../.." && pwd)"
    say "Using the code in $MUSE_CODE_DIR"
    return
  fi
  MUSE_CODE_DIR="$MUSE_HOME/openclaw"
  if [ -d "$MUSE_CODE_DIR/.git" ]; then
    say "Updating $MUSE_CODE_DIR"
    git -C "$MUSE_CODE_DIR" fetch --depth 1 origin "$MUSE_BRANCH"
    git -C "$MUSE_CODE_DIR" checkout -q -B "$MUSE_BRANCH" FETCH_HEAD
  else
    say "Downloading OpenClaw ($MUSE_BRANCH)"
    mkdir -p "$MUSE_HOME"
    git clone --depth 1 --branch "$MUSE_BRANCH" "$MUSE_REPO" "$MUSE_CODE_DIR"
  fi
}

public_ip() {
  local ip=""
  ip="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if [ -z "$ip" ]; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<NF;i++) if ($i=="src") print $(i+1)}' | head -1)"
  fi
  printf '%s' "$ip"
}

collect_answers() {
  # Keep earlier answers on a re-run.
  if [ -f "$MUSE_ENV_FILE" ]; then
    say "Reusing settings from $MUSE_ENV_FILE"
    set -a; . "$MUSE_ENV_FILE"; set +a
  fi

  ask ANTHROPIC_API_KEY "Anthropic API key (from console.anthropic.com)" "" secret
  [ -n "${ANTHROPIC_API_KEY:-}" ] || die "An Anthropic API key is required."

  local ip default_site
  ip="$(public_ip)"
  default_site="${ip//./-}.sslip.io"
  ask MUSE_DOMAIN "Domain for Muse (leave empty to use $default_site)" ""
  MUSE_SITE="${MUSE_DOMAIN:-${MUSE_SITE:-$default_site}}"

  ask TELEGRAM_BOT_TOKEN "Telegram bot token from @BotFather (empty to skip Telegram)" ""
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    ask MUSE_TELEGRAM_OWNER "Your numeric Telegram user id (ask @userinfobot)" ""
  fi
  ask MUSE_WHATSAPP_OWNER "Your WhatsApp number with country code, e.g. +420123456789 (empty to skip)" ""
  MUSE_MODEL="${MUSE_MODEL:-anthropic/claude-opus-5-5}"

  OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-$(rand_hex 32)}"
  MUSE_WATCH_KEY="${MUSE_WATCH_KEY:-$(rand_hex 24)}"
  MUSE_VNC_PASSWORD="${MUSE_VNC_PASSWORD:-$(rand_hex 4)}"
}

write_env() {
  say "Writing $MUSE_ENV_FILE"
  mkdir -p "$MUSE_DATA_DIR/openclaw/workspace"
  umask 077
  cat >"$MUSE_ENV_FILE" <<EOF
# Muse secrets. Keep this file private; it is never part of the code checkout.
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
OPENCLAW_GATEWAY_TOKEN=$OPENCLAW_GATEWAY_TOKEN
MUSE_SITE=$MUSE_SITE
MUSE_DOMAIN=${MUSE_DOMAIN:-}
MUSE_WATCH_KEY=$MUSE_WATCH_KEY
MUSE_VNC_PASSWORD=$MUSE_VNC_PASSWORD
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
MUSE_TELEGRAM_OWNER=${MUSE_TELEGRAM_OWNER:-}
MUSE_WHATSAPP_OWNER=${MUSE_WHATSAPP_OWNER:-}
MUSE_MODEL=$MUSE_MODEL
MUSE_CODE_DIR=$MUSE_CODE_DIR
EOF
  chmod 600 "$MUSE_ENV_FILE"
  umask 022
}

write_config() {
  say "Writing the OpenClaw configuration"
  python3 "$MUSE_CODE_DIR/deploy/muse/make-config.py" \
    --env-file "$MUSE_ENV_FILE" \
    --out "$MUSE_DATA_DIR/openclaw/openclaw.json"
  # The gateway container runs as uid 1000 (node).
  chown -R 1000:1000 "$MUSE_DATA_DIR/openclaw"
}

install_helper() {
  install -m 0755 "$MUSE_CODE_DIR/deploy/muse/muse" /usr/local/bin/muse
  mkdir -p /etc/muse
  printf 'MUSE_CODE_DIR=%s\nMUSE_DATA_DIR=%s\nMUSE_ENV_FILE=%s\n' "$MUSE_CODE_DIR" "$MUSE_DATA_DIR" "$MUSE_ENV_FILE" >/etc/muse/paths
}

start_stack() {
  say "Building and starting Muse (the first build takes about 5 to 10 minutes)"
  muse up
  say "Waiting for Muse to answer"
  local i
  for i in $(seq 1 60); do
    if muse health >/dev/null 2>&1; then break; fi
    sleep 5
  done
  muse health || warn "The gateway is not healthy yet. Check: muse logs gateway"
  say "Checking that Claude answers (and picking a working model)"
  muse doctor || warn "The model check failed. Run 'muse doctor' again after fixing the message above."
}

main() {
  require_root
  install_system
  fetch_code
  collect_answers
  write_env
  write_config
  install_helper
  if [ "$MUSE_SKIP_START" != "1" ]; then
    start_stack
  fi
  muse info
}

main "$@"
