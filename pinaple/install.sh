#!/usr/bin/env bash
# Pinaple installer for a fresh Ubuntu/Debian server (Oracle Free, Hetzner, any VPS).
# Run as a normal user with sudo rights:  bash install.sh
# Safe to run again: it keeps your keys, choices and Pinaple's memory.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$HOME/.openclaw"
WORKSPACE="$STATE_DIR/workspace"
ENV_FILE="$STATE_DIR/.env"

say() { printf '\n🍍 %s\n' "$*"; }
die() { printf '\n❌ %s\n' "$*" >&2; exit 1; }
env_get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- || true; }

[ "$(id -u)" -ne 0 ] || die "Run as a normal user (not root). The script uses sudo when needed."
command -v sudo >/dev/null || die "sudo is required."

# 1) System tools: Node.js 24 (OpenClaw needs 24.16+ or 26.1+; Node 25 is not supported)
#    and ffmpeg (turns Pinaple's voice into WhatsApp/Telegram voice notes).
node_ok() {
  command -v node >/dev/null || return 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);
    process.exit((a===24&&b>=16)||(a===26&&b>=1)||a>26?0:1)'
}
if ! node_ok || ! command -v ffmpeg >/dev/null || ! command -v openssl >/dev/null; then
  say "Installing system tools..."
  sudo apt-get update -y
  sudo apt-get install -y curl ca-certificates build-essential openssl ffmpeg
fi
if ! node_ok; then
  say "Installing Node.js 24..."
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
say "$(openclaw --version 2>/dev/null | head -n 1) ready."

# 3) Your answers and keys -> ~/.openclaw/.env (private file, never in git)
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
if [ -n "$(env_get ANTHROPIC_API_KEY)" ] && [ -n "$(env_get PINAPLE_CHANNELS)" ]; then
  say "Found your saved keys and choices in $ENV_FILE, keeping them."
else
  say "A few questions. Keys are saved only on this server, in $ENV_FILE."
  read -r -s -p "Anthropic API key (sk-ant-...): " ANTHROPIC_API_KEY; echo
  [ -n "$ANTHROPIC_API_KEY" ] || die "Anthropic API key is required."

  echo
  echo "Where do you want to chat with Pinaple?"
  echo "  1) WhatsApp"
  echo "  2) Telegram"
  echo "  3) Both"
  read -r -p "Choose 1, 2 or 3 [1]: " choice
  case "${choice:-1}" in
    1) CHANNELS="whatsapp" ;;
    2) CHANNELS="telegram" ;;
    3) CHANNELS="whatsapp,telegram" ;;
    *) die "Please choose 1, 2 or 3." ;;
  esac

  PHONE=""
  WA_MODE=""
  if [[ ",$CHANNELS," == *",whatsapp,"* ]]; then
    echo
    echo "How should Pinaple work in WhatsApp?"
    echo "  1) Pinaple has its own number (second SIM). You save it as a contact and chat with it."
    echo "  2) Pinaple uses YOUR number. You chat with it in \"Message yourself\"."
    read -r -p "Choose 1 or 2 [1]: " wa_choice
    case "${wa_choice:-1}" in
      1) WA_MODE="contact" ;;
      2) WA_MODE="self" ;;
      *) die "Please choose 1 or 2." ;;
    esac
    read -r -p "YOUR personal WhatsApp number with country code (example +420601234567): " PHONE
    PHONE="${PHONE// /}"
    [[ "$PHONE" =~ ^\+[0-9]{7,15}$ ]] || die "That number does not look right. Use + and digits only."
  fi

  TELEGRAM_BOT_TOKEN=""
  if [[ ",$CHANNELS," == *",telegram,"* ]]; then
    read -r -s -p "Telegram bot token from @BotFather: " TELEGRAM_BOT_TOKEN; echo
    [ -n "$TELEGRAM_BOT_TOKEN" ] || die "Telegram bot token is required for Telegram."
  fi

  echo
  echo "Optional: a Groq key lets Pinaple understand your voice messages (free at https://console.groq.com/keys)."
  read -r -s -p "Groq API key (gsk_..., press Enter to skip): " GROQ_API_KEY; echo

  GATEWAY_TOKEN="$(openssl rand -hex 24)"
  umask 077
  {
    echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"
    echo "OPENCLAW_GATEWAY_TOKEN=$GATEWAY_TOKEN"
    echo "PINAPLE_CHANNELS=$CHANNELS"
    [ -z "$PHONE" ] || echo "PINAPLE_WHATSAPP_NUMBER=$PHONE"
    [ -z "$WA_MODE" ] || echo "PINAPLE_WHATSAPP_MODE=$WA_MODE"
    [ -z "$TELEGRAM_BOT_TOKEN" ] || echo "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN"
    [ -z "$GROQ_API_KEY" ] || echo "GROQ_API_KEY=$GROQ_API_KEY"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

CHANNELS="$(env_get PINAPLE_CHANNELS)"
PHONE="$(env_get PINAPLE_WHATSAPP_NUMBER)"
WA_MODE="$(env_get PINAPLE_WHATSAPP_MODE)"
WA_MODE="${WA_MODE:-self}"
has_channel() { [[ ",$CHANNELS," == *",$1,"* ]]; }

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

# 6) Chat apps and add-ons
PATCH="$(mktemp)"
trap 'rm -f "$PATCH"' EXIT

# Install a plugin once; on later runs just make sure it is switched on.
ensure_plugin() {
  if openclaw plugins inspect "$1" >/dev/null 2>&1; then
    openclaw plugins enable "$1" >/dev/null
  else
    openclaw plugins install "$2"
  fi
}

if has_channel whatsapp; then
  [ -n "$PHONE" ] || die "PINAPLE_WHATSAPP_NUMBER is missing in $ENV_FILE."
  say "Adding WhatsApp..."
  ensure_plugin whatsapp @openclaw/whatsapp
  # Only YOUR number may talk to Pinaple; everyone else is ignored.
  # contact mode: Pinaple owns its own number and you message it like a contact.
  # self mode: Pinaple lives in your own "Message yourself" chat.
  if [ "$WA_MODE" = "contact" ]; then SELF_CHAT=false; else SELF_CHAT=true; fi
  cat > "$PATCH" <<JSON
{
  channels: {
    whatsapp: {
      enabled: true,
      dmPolicy: "allowlist",
      allowFrom: ["$PHONE"],
      selfChatMode: $SELF_CHAT,
      groupPolicy: "disabled",
    },
  },
}
JSON
  openclaw config patch --file "$PATCH"
fi

if has_channel telegram; then
  say "Adding Telegram..."
  cat > "$PATCH" <<'JSON'
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "${TELEGRAM_BOT_TOKEN}",
      dmPolicy: "pairing",
      groups: { "*": { requireMention: true } },
    },
  },
}
JSON
  openclaw config patch --file "$PATCH"
fi

if [ -n "$(env_get GROQ_API_KEY)" ]; then
  say "Adding voice message understanding (Groq)..."
  ensure_plugin groq @openclaw/groq-provider
  cat > "$PATCH" <<'JSON'
{
  models: { providers: { groq: { apiKey: "${GROQ_API_KEY}" } } },
  tools: { media: { models: [{ provider: "groq", capabilities: ["audio"] }] } },
}
JSON
  openclaw config patch --file "$PATCH"
fi

# 7) Upgrade the config format if this OpenClaw version expects a newer one, then check it
openclaw doctor --fix --non-interactive --no-workspace-suggestions >/dev/null 2>&1 || true
openclaw config validate || die "Config is invalid. Run: openclaw doctor"

# 8) Keep running after you log out, then install + start the background service
sudo loginctl enable-linger "$(id -un)" || true
openclaw gateway install --force

# 9) Link WhatsApp by scanning a QR code with your phone
if has_channel whatsapp; then
  if [ "$WA_MODE" = "contact" ]; then
    say "Link WhatsApp: open WhatsApp (or WhatsApp Business) that runs on PINAPLE's number, then Settings > Linked devices > Link a device."
  else
    say "Link WhatsApp: on your phone open WhatsApp > Settings > Linked devices > Link a device."
  fi
  read -r -p "Ready to scan the QR code now? [Y/n]: " link || link="n"
  if [[ "${link:-y}" =~ ^[Yy]$ ]]; then
    openclaw channels login --channel whatsapp
    openclaw gateway restart
  else
    say "Skipped. Link later with: openclaw channels login --channel whatsapp"
  fi
fi

say "Pinaple is installed and running!"
if has_channel whatsapp && [ "$WA_MODE" = "contact" ]; then
  cat <<'MSG'

WhatsApp test:
  On YOUR phone, add Pinaple's number as a new contact named "Pinaple 🍍".
  Open the chat with Pinaple and write: Hi Pinaple!
  Pinaple answers with text and a voice message.
MSG
elif has_channel whatsapp; then
  cat <<'MSG'

WhatsApp test:
  Open WhatsApp, open the chat with yourself ("Message yourself"),
  and write: Hi Pinaple!
  Pinaple answers there with text and a voice message.
MSG
fi
if has_channel telegram; then
  cat <<'MSG'

Telegram test:
  1. Send any message to your bot. It answers with a pairing code.
  2. On this server run:
       openclaw pairing list telegram
       openclaw pairing approve telegram <CODE>
  3. Say hi to Pinaple 🍍
MSG
fi
cat <<'MSG'

Voice: Pinaple answers with voice messages. Type "/tts off" for text only, "/tts on" for voice again.

Useful commands:
  openclaw status              health check
  openclaw logs --follow       live logs
  openclaw gateway restart     restart Pinaple
  openclaw doctor              find and fix problems
MSG
