#!/usr/bin/env bash
# Installs Home Control as a service that starts by itself whenever the computer turns on.
# For a Raspberry Pi (Raspberry Pi OS) or any Debian/Ubuntu computer.
#
#   cd crestron-home-app/web
#   ./install-linux.sh
#
# Run it again after updating the app to restart it with the new version.
set -euo pipefail
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
PORT="${PORT:-8080}"

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if ! command -v node >/dev/null || [ "$(node_major)" -lt 22 ]; then
  echo "Installing Node.js 22 (from NodeSource, the usual source for Raspberry Pi and Ubuntu)…"
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Installing the app's packages…"
npm install --omit=dev --no-audit --no-fund

# The Setup PIN protects the page that holds the Crestron token. It is kept in a
# root-only file (not in the service file, which anyone on the computer can read).
ENV_FILE=/etc/home-control.env
if [ -z "${ADMIN_PIN:-}" ] && sudo test -f "$ENV_FILE"; then
  ADMIN_PIN="$(sudo sed -n 's/^ADMIN_PIN=//p' "$ENV_FILE")"
fi
if [ -z "${ADMIN_PIN:-}" ] && [ -t 0 ]; then
  while :; do
    read -rsp "Choose a Setup PIN (4 or more digits, protects the Crestron settings): " ADMIN_PIN; echo
    [[ "$ADMIN_PIN" =~ ^[0-9]{4,}$ ]] && break
    echo "Use at least 4 digits."
  done
fi
if [ -n "${ADMIN_PIN:-}" ]; then
  printf 'ADMIN_PIN=%s\n' "$ADMIN_PIN" | sudo tee "$ENV_FILE" >/dev/null
  sudo chmod 600 "$ENV_FILE"
else
  echo "Warning: no Setup PIN set. Anyone on your Wi-Fi could open Setup. Run again with ADMIN_PIN=1234 ./install-linux.sh"
fi

echo "Setting up the service…"
sudo tee /etc/systemd/system/home-control.service >/dev/null <<EOF
[Unit]
Description=Home Control (Crestron web app)
After=network-online.target
Wants=network-online.target

[Service]
User=$(id -un)
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT
EnvironmentFile=-$ENV_FILE
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable home-control >/dev/null
sudo systemctl restart home-control

IP="$(hostname -I | awk '{print $1}')"
echo
echo "Home Control is running and will start by itself after a restart."
echo "On the iPad, open Safari and go to:  http://$IP:$PORT"
echo "(or http://$(hostname).local:$PORT)"
echo "Logs: journalctl -u home-control -f"
