#!/usr/bin/env bash
# Pinaple installer for a fresh Ubuntu/Debian server (Oracle Free, Hetzner, any VPS).
# Run as a normal user with sudo rights:  bash install.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$HOME/.openclaw"
WORKSPACE="$STATE_DIR/workspace"
ENV_FILE="$STATE_DIR/.env"

say() { printf '\n🍍 %s\n' "$*"; }
die() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "Run as a normal user (not root). The script uses sudo when needed."
command -v sudo >/dev/null || die "sudo is required."

# 1) Node.js 24 (OpenClaw needs Node 24.16+ or 26.1+; Node 25 is not supported)
node_ok() {
  command -v node >/dev/null || return 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);
    process.exit((a===24&&b>=16)||(a===26&&b>=1)||a>26?0:1)'
}
if ! node_ok; then
  say "Installing Node.js 24..."
  sudo apt-get update -y
  sudo apt-get install -y curl ca-certificates build-essential openssl
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
  node_ok || die "Node.js 24.16+ is required but $(node -v 2>/dev/null || echo none) is installed."
fi
say "Node $(node -v) ready."

# 2) OpenClaw engine (Pinaple runs on top of it)
if ! command -v openclaw >/dev/null; then
  say "Installing the OpenClaw engine..."
  sudo npm install -g openclaw@latest
fi
say "OpenClaw $(openclaw --version 2>/dev/null || echo installed) ready."

# 3) Secrets -> ~/.openclaw/.env (private file, never in git)
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
if [ -f "$ENV_FILE" ] && grep -q '^ANTHROPIC_API_KEY=' "$ENV_FILE" && grep -q '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE"; then
  say "Found existing secrets in $ENV_FILE, keeping them."
else
  say "Paste your keys. They are saved only on this server, in $ENV_FILE."
  read -r -s -p "Anthropic API key (sk-ant-...): " ANTHROPIC_API_KEY; echo
  [ -n "$ANTHROPIC_API_KEY" ] || die "Anthropic API key is required."
  read -r -s -p "Telegram bot token from @BotFather: " TELEGRAM_BOT_TOKEN; echo
  [ -n "$TELEGRAM_BOT_TOKEN" ] || die "Telegram bot token is required."
  GATEWAY_TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  umask 077
  {
    echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"
    echo "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN"
    echo "OPENCLAW_GATEWAY_TOKEN=$GATEWAY_TOKEN"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# 4) Config (back up any existing one)
if [ -f "$STATE_DIR/openclaw.json" ]; then
  backup="$STATE_DIR/openclaw.json.bak.$(date +%Y%m%d%H%M%S)"
  cp "$STATE_DIR/openclaw.json" "$backup"
  say "Old config backed up to $backup"
fi
cp "$HERE/openclaw.json" "$STATE_DIR/openclaw.json"
chmod 600 "$STATE_DIR/openclaw.json"

# 5) Pinaple personality (never overwrites files Pinaple already edited)
mkdir -p "$WORKSPACE"
for f in IDENTITY.md SOUL.md USER.md; do
  if [ -f "$WORKSPACE/$f" ]; then
    say "Keeping existing $f"
  else
    cp "$HERE/workspace/$f" "$WORKSPACE/$f"
  fi
done

# 6) Upgrade the config format if this OpenClaw version expects a newer one, then check it
openclaw doctor --fix --non-interactive --no-workspace-suggestions >/dev/null 2>&1 || true
openclaw config validate || die "Config is invalid. Run: openclaw doctor"

# 7) Keep running after you log out, then install + start the background service
sudo loginctl enable-linger "$(id -un)" || true
openclaw gateway install --force

say "Pinaple is installed and running!"
cat <<'MSG'

Next steps:
  1. Open Telegram and send any message to your bot.
     The bot answers with a pairing code.
  2. On this server run:
       openclaw pairing list telegram
       openclaw pairing approve telegram <CODE>
  3. Say hi to Pinaple 🍍

Useful commands:
  openclaw status              health check
  openclaw logs --follow       live logs
  openclaw gateway restart     restart Pinaple
  openclaw doctor              find and fix problems
MSG
