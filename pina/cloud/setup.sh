#!/usr/bin/env bash
# Piña server setup. Runs once on a fresh Ubuntu 24.04 server (cloud-init calls it), and is
# safe to run again over SSH: `sudo bash /opt/pina/setup.sh`.
# Everything lives in /opt/pina. Progress is logged to /var/log/pina-setup.log.
set -euo pipefail
exec > >(tee -a /var/log/pina-setup.log) 2>&1
echo "== Piña setup started $(date -u +%FT%TZ)"

PINA=/opt/pina
ENV_FILE="$PINA/.env"
STATE="$PINA/config"         # mounted at /home/node/.openclaw inside the container
WORKSPACE="$PINA/workspace"  # mounted at /home/node/.openclaw/workspace
SECRETS="$PINA/auth-secrets" # mounted at /home/node/.config/openclaw
BACKUPS="$PINA/backups"

if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo)."; exit 1; fi
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE. Fill in the values from the setup guide first."; exit 1; }
chmod 600 "$ENV_FILE"

env_get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//'; }
env_set() {
  if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
}

# 1. Check the owner's values before doing anything slow.
missing=()
for key in ANTHROPIC_API_KEY TELEGRAM_BOT_TOKEN OWNER_TELEGRAM_ID; do
  value="$(env_get "$key")"
  if [ -z "$value" ] || [ "$value" = "CHANGE_ME" ]; then missing+=("$key"); fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "These values are still empty in $ENV_FILE: ${missing[*]}"
  echo "Edit the file (sudo nano $ENV_FILE) and run: sudo bash $PINA/setup.sh"
  exit 1
fi
OWNER_ID="$(env_get OWNER_TELEGRAM_ID)"
if ! [[ "$OWNER_ID" =~ ^[0-9]+$ ]]; then
  echo "OWNER_TELEGRAM_ID must be the number that @userinfobot shows you, not a @username."
  exit 1
fi

# 2. Generated secrets: a private gateway token and a password for gog's token store.
[ -n "$(env_get OPENCLAW_GATEWAY_TOKEN)" ] || env_set OPENCLAW_GATEWAY_TOKEN "$(openssl rand -hex 32)"
[ -n "$(env_get GOG_KEYRING_PASSWORD)" ] || env_set GOG_KEYRING_PASSWORD "$(openssl rand -hex 24)"
[ -n "$(env_get OPENCLAW_TZ)" ] || env_set OPENCLAW_TZ "Europe/Prague"
OWNER_TZ="$(env_get OPENCLAW_TZ)"
[ -f "/usr/share/zoneinfo/$OWNER_TZ" ] || { echo "OPENCLAW_TZ=$OWNER_TZ is not a known time zone (example: Europe/Prague)."; exit 1; }

# 3. Swap, so a 1-2 GB server does not run out of memory when the browser starts.
if ! swapon --show | grep -q . && [ "$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)" -lt 3500 ]; then
  echo "== Adding a 2 GB swap file"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 4. Docker from Ubuntu's own packages, plus automatic security updates.
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "== Installing Docker"
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 unattended-upgrades
  systemctl enable --now docker
fi

# 5. Folders the container writes to belong to its user (uid 1000), and nobody else.
install -d -m 700 -o 1000 -g 1000 "$STATE" "$WORKSPACE" "$SECRETS" "$BACKUPS"

# 6. First run only: copy the starter config and Piña's workspace files into place.
#    Later runs never overwrite what Piña or you changed.
if [ ! -f "$STATE/openclaw.json" ]; then
  sed -e "s/__OWNER_TELEGRAM_ID__/$OWNER_ID/g" -e "s#__OWNER_TZ__#$OWNER_TZ#g" \
    "$PINA/template/openclaw.json5" > "$STATE/openclaw.json"
fi
cp -rn "$PINA/template/workspace/." "$WORKSPACE/"
for name in USER IDENTITY; do
  if [ ! -f "$WORKSPACE/$name.md" ] && [ -f "$WORKSPACE/$name.example.md" ]; then
    mv "$WORKSPACE/$name.example.md" "$WORKSPACE/$name.md"
  fi
done
sed -i "s/__OWNER_TELEGRAM_ID__/$OWNER_ID/g" "$WORKSPACE/USER.md"
chown -R 1000:1000 "$STATE" "$WORKSPACE" "$SECRETS" "$BACKUPS"
chmod 600 "$STATE/openclaw.json"

# 7. Build the small image layer (adds the Gmail/Calendar tool) and start Piña.
cd "$PINA"
echo "== Building and starting Piña (this can take a few minutes)"
docker compose build --pull
# Check the config before starting: an invalid config would make the container restart forever.
if ! docker compose run -T --rm --no-deps --entrypoint node openclaw-gateway dist/index.js config validate; then
  echo "The config in $STATE/openclaw.json is not valid. Fix it, then run: sudo bash $PINA/setup.sh"
  exit 1
fi
docker compose up -d openclaw-gateway

# 8. A shortcut for later: `pina <openclaw command>` runs the OpenClaw CLI inside the stack.
cat > /usr/local/bin/pina <<'SH'
#!/usr/bin/env bash
cd /opt/pina || exit 1
case "${1:-}" in
  logs) exec docker compose logs -f --tail=100 openclaw-gateway ;;
  restart) exec docker compose restart openclaw-gateway ;;
  update) docker compose build --pull && exec docker compose up -d openclaw-gateway ;;
  backup) exec docker compose run --rm -v /opt/pina/backups:/backups openclaw-cli backup create --output /backups --verify ;;
  ""|help) echo "Usage: pina logs | restart | update | backup | <any openclaw command>"
           echo "Examples: pina channels status --probe   pina security audit   pina nodes pending"; exit 0 ;;
  *) exec docker compose run --rm openclaw-cli "$@" ;;
esac
SH
chmod 755 /usr/local/bin/pina

# 9. Wait for the gateway to report healthy, then say hello on Telegram.
echo "== Waiting for Piña to wake up"
status=starting
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$(docker compose ps -q openclaw-gateway)" 2>/dev/null || echo starting)"
  [ "$status" = "healthy" ] && break
  sleep 5
done
echo "Gateway status: $status"
if [ "$status" = "healthy" ]; then
  text="🍍 Piña is awake on its own computer. Say hi!"
else
  text="🍍 Piña's server finished setup but the assistant is not healthy yet ($status). Check /var/log/pina-setup.log or run: pina logs"
fi
curl -fsS -m 20 "https://api.telegram.org/bot$(env_get TELEGRAM_BOT_TOKEN)/sendMessage" \
  --data-urlencode "chat_id=$OWNER_ID" --data-urlencode "text=$text" >/dev/null \
  || echo "Could not send the Telegram hello. Open your bot in Telegram and tap Start, then message it."
echo "== Piña setup finished $(date -u +%FT%TZ)"
