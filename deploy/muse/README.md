# Muse

Muse turns one Ubuntu or Debian server (for example a Hetzner Cloud VPS) into your own always-on AI computer.

- OpenClaw with Claude, reachable from WhatsApp, Telegram, a private web chat and the Pineapple iPhone app.
- A Chromium desktop that Muse drives and you can watch or take over from your phone.
- Caddy for HTTPS.
- The Muse Sentinel plugin (`extensions/muse-sentinel`), which asks you before Muse sends, posts, submits forms, books, buys or deletes anything.

## Install

Run as root on a fresh server:

```bash
curl -fsSL https://raw.githubusercontent.com/divis950/openclaw/muse-cloud/deploy/muse/install.sh | bash
```

When it finishes, run `muse info` for your links and `muse help` for everyday commands.

Full guide: [https://docs.openclaw.ai/install/muse](https://docs.openclaw.ai/install/muse)

## Files

- `install.sh`: the installer.
- `muse`: the helper command (installed to `/usr/local/bin/muse`).
- `make-config.py`: writes `openclaw.json` from `/srv/muse/muse.env`.
- `docker-compose.yml`: the gateway, desktop and Caddy containers.
- `Caddyfile`: HTTPS, the web chat and the desktop page.
- `desktop/`: the Chromium, noVNC and watch page image.
