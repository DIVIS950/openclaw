#!/usr/bin/env bash
# Starts the virtual screen, a window manager, Chromium with a persistent profile, CDP for the
# agent (only reachable from the gateway), and noVNC for watching. Exits when any part dies so
# Docker restarts the whole desktop.
set -euo pipefail

# Portrait by default: you mostly watch it on a phone. Sites still get a 1024 px desktop layout.
SCREEN_SIZE="${MUSE_SCREEN:-1024x1400}"
CDP_PORT="${MUSE_CDP_PORT:-9222}"
CDP_INTERNAL_PORT=$((CDP_PORT + 1))
NOVNC_PORT="${MUSE_NOVNC_PORT:-6080}"
CDP_ALLOW_FROM="${MUSE_CDP_ALLOW_FROM:-}"
VNC_PASSWORD="${MUSE_VNC_PASSWORD:-}"
PROFILE_DIR="${MUSE_PROFILE_DIR:-/data/chrome}"
WIDTH="${SCREEN_SIZE%x*}"
HEIGHT="${SCREEN_SIZE#*x}"

export DISPLAY=:1
export HOME="${HOME:-/home/muse}"
# Without these Chromium shows a "Google API keys are missing" bar on every start.
export GOOGLE_API_KEY=no GOOGLE_DEFAULT_CLIENT_ID=no GOOGLE_DEFAULT_CLIENT_SECRET=no

# Leftovers from a previous run would stop X and Chromium from starting.
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true
mkdir -p "$PROFILE_DIR"
rm -f "$PROFILE_DIR"/SingletonLock "$PROFILE_DIR"/SingletonSocket "$PROFILE_DIR"/SingletonCookie
if [ -f "$PROFILE_DIR/Default/Preferences" ]; then
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' \
    "$PROFILE_DIR/Default/Preferences" || true
fi

Xvfb :1 -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp -ac &
for _ in $(seq 1 50); do
  [ -S /tmp/.X11-unix/X1 ] && break
  sleep 0.1
done

openbox --sm-disable >/dev/null 2>&1 &

chrome_args=(
  --user-data-dir="$PROFILE_DIR"
  --remote-debugging-address=127.0.0.1
  --remote-debugging-port="$CDP_INTERNAL_PORT"
  --no-first-run
  --no-default-browser-check
  --disable-dev-shm-usage
  --disable-features=Translate,MediaRouter
  --password-store=basic
  --hide-crash-restore-bubble
  --start-maximized
  --window-position=0,0
  --window-size="${WIDTH},${HEIGHT}"
)
# Docker's default seccomp profile blocks Chromium's sandbox for non-root users on many hosts.
if [ "${MUSE_CHROME_NO_SANDBOX:-1}" = "1" ]; then
  # --test-type hides the "unsupported command-line flag" warning bar that --no-sandbox adds.
  chrome_args+=(--no-sandbox --test-type)
fi
chromium "${chrome_args[@]}" "${MUSE_START_URL:-about:blank}" >/tmp/chromium.log 2>&1 &
for _ in $(seq 1 100); do
  # Bash's /dev/tcp avoids needing curl in the image.
  if (exec 3<>"/dev/tcp/127.0.0.1/${CDP_INTERNAL_PORT}") 2>/dev/null; then
    break
  fi
  sleep 0.1
done

# CDP has no authentication, so only the gateway's address may connect when one is given.
# TCP4 tells socat the address family, which it needs before it accepts a range.
socat_listen="TCP4-LISTEN:${CDP_PORT},fork,reuseaddr"
if [ -n "$CDP_ALLOW_FROM" ]; then
  # socat wants address/mask; accept a bare address too.
  case "$CDP_ALLOW_FROM" in
    */*) cdp_range="$CDP_ALLOW_FROM" ;;
    *) cdp_range="${CDP_ALLOW_FROM}/32" ;;
  esac
  socat_listen="${socat_listen},range=${cdp_range}"
fi
socat "$socat_listen" "TCP:127.0.0.1:${CDP_INTERNAL_PORT}" &

vnc_args=(-display :1 -rfbport 5900 -localhost -shared -forever -noxdamage -quiet)
if [ -n "$VNC_PASSWORD" ]; then
  mkdir -p "$HOME/.vnc"
  x11vnc -storepasswd "$VNC_PASSWORD" "$HOME/.vnc/passwd" >/dev/null 2>&1
  vnc_args+=(-rfbauth "$HOME/.vnc/passwd")
else
  vnc_args+=(-nopw)
fi
x11vnc "${vnc_args[@]}" >/tmp/x11vnc.log 2>&1 &

websockify --web /usr/share/novnc "$NOVNC_PORT" localhost:5900 >/tmp/websockify.log 2>&1 &

wait -n
echo "muse-desktop: a process exited; stopping so Docker restarts the desktop" >&2
exit 1
