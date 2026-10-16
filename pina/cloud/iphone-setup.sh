#!/usr/bin/env bash
# Optional: pair the official OpenClaw iPhone app (App Store) with Piña, privately over Tailscale.
# Nothing is opened to the internet: Tailscale forwards https://<server>.<tailnet>.ts.net to the
# gateway on this server's 127.0.0.1 only.
# Usage (on the server): sudo bash /opt/pina/iphone-setup.sh [--allow-phone-writes]
#   --allow-phone-writes  also lets Piña ADD events and reminders on the phone (off by default;
#                         `openclaw security audit` reports this as a high-impact permission).
set -euo pipefail
ALLOW_WRITES=false
[ "${1:-}" = "--allow-phone-writes" ] && ALLOW_WRITES=true
PINA=/opt/pina
ENV_FILE="$PINA/.env"
DOCKER_GATEWAY_IP=172.30.255.1 # fixed in docker-compose.yml
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }
cd "$PINA"

env_set() {
  if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
}

# 1. Tailscale on the server. `tailscale up` prints a login link: open it on your iPhone.
if ! command -v tailscale >/dev/null 2>&1; then
  echo "== Installing Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
fi
if ! tailscale status >/dev/null 2>&1; then
  echo "== Log this server into your Tailscale account (open the link below on your iPhone)"
  tailscale up --hostname pina
fi
DNS="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
[ -n "$DNS" ] || { echo "Could not read this server's Tailscale name. Is MagicDNS on?"; exit 1; }
echo "Tailscale name: $DNS"

# 2. Gateway listens on the Docker network and trusts only Tailscale's forwarded requests.
env_set OPENCLAW_GATEWAY_BIND lan
env_set COMPOSE_FILE docker-compose.yml:docker-compose.iphone.yml
ALLOW_LIST='[]'
$ALLOW_WRITES && ALLOW_LIST='["calendar.add", "reminders.add"]'
patch="$(mktemp)"
cat > "$patch" <<JSON
{
  gateway: {
    bind: "lan",
    auth: { rateLimit: { maxAttempts: 10, windowMs: 60000, lockoutMs: 300000 } },
    trustedProxies: ["$DOCKER_GATEWAY_IP"],
    publicOrigin: "https://$DNS",
    controlUi: { enabled: true },
    nodes: { commands: { allow: $ALLOW_LIST } },
  },
  plugins: { entries: { "device-pair": { config: { publicUrl: "wss://$DNS" } } } },
}
JSON
docker compose run --rm -T openclaw-cli config patch --stdin < "$patch"
rm -f "$patch"
docker compose run --rm -T --no-deps --entrypoint node openclaw-gateway dist/index.js config validate

# 3. Restart with the local-only port, then let Tailscale serve it over HTTPS inside your tailnet.
docker compose up -d
tailscale serve --bg 18789
echo "== Waiting for the gateway"
for _ in $(seq 1 40); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q openclaw-gateway)" 2>/dev/null)" = healthy ] && break
  sleep 5
done

# 4. A one-time setup code (valid 10 minutes) for the iPhone app.
echo
echo "== On your iPhone: turn on Tailscale, open OpenClaw, choose Connect Manually / Gateway Setup,"
echo "   tap 'Enter setup code' and paste the code below (or scan the QR code)."
docker compose exec openclaw-gateway node dist/index.js qr --url "wss://$DNS"
echo
echo "If the app waits for approval:  pina devices list   then   pina devices approve <id>"
echo "New phone permissions later:   pina nodes pending   then   pina nodes approve <id>"
echo "The web dashboard is at https://$DNS (approve your browser with: pina devices approve <id>)."
