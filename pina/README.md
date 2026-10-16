# Piña

Piña is a personal assistant with a pineapple mascot, built for one iPhone owner. It has three
parts:

| Part | What it is | Where |
| --- | --- | --- |
| Piña app | A claude.ai page that runs in the Claude iPhone app: today's Google Calendar and unread Gmail, a chat with email and calendar tools (it asks before sending or changing anything), and a private to-do list. | [Open the Piña app](https://claude.ai/artifact/BDhQgrHqfr6UNE91dYxcTD), source in `app/pina.html` |
| Piña on its own computer | An OpenClaw 2026.10.4 agent in Docker on a small cloud server, reached through a Telegram bot. It browses, runs programs in its container, keeps files, sets reminders, and reads Gmail and Calendar through `gog`. | `cloud/`, `config/`, `workspace/` |
| OpenClaw iPhone app (optional) | The official App Store app, paired privately over Tailscale, so Piña can use the phone's location, notifications, photos, calendar and reminders. | `cloud/iphone-setup.sh` |

The owner follows the [Piña Setup guide](https://claude.ai/artifact/H3VShAym5jyfyquTEyq3Nq) on
their phone. It builds the server setup from their keys, so nothing is edited by hand.

## How the server setup works

1. `cloud/cloud-init.yaml` is pasted into the provider's "cloud config" box. It writes
   `/opt/pina/.env` (the owner's keys) and the files below, then runs `setup.sh`.
2. `cloud/setup.sh` checks the keys, adds swap on small servers, installs Docker from Ubuntu's
   packages, copies the starter config and workspace once (never overwriting later changes),
   builds the image, validates the config, starts the stack and greets the owner on Telegram.
3. `cloud/Dockerfile` extends `ghcr.io/openclaw/openclaw:2026.10.4-browser` (Chromium included)
   with `gog`, installed by `cloud/install-gog.mjs` with checksum verification. A failed `gog`
   download never breaks the build; Gmail and Calendar just stay off.
4. `cloud/docker-compose.yml` follows the release's own compose file: gateway bound to loopback,
   no published ports, health check, and an `openclaw-cli` service that shares the gateway's
   network and process namespace. `pina <command>` on the server wraps it.
5. Optional: with a Tailscale auth key in `.env`, `cloud/iphone-setup.sh` joins the tailnet,
   serves the gateway over HTTPS inside the tailnet only, and sends the iPhone app's one-time
   setup code to the owner's Telegram.

## Security model

- Telegram `dmPolicy: "allowlist"` with only the owner's numeric id; groups disabled.
- The gateway listens on loopback inside the container. Telegram uses long polling, so the
  server needs no inbound ports. The optional iPhone route is published on `127.0.0.1` and
  reached through Tailscale Serve, never the public internet.
- Shell commands run with full trust inside the container (`tools.exec.mode: "full"`): it is
  the agent's own computer. `openclaw security audit` reports this as the only warning.
- Tools that change OpenClaw's own settings (`gateway`, `openclaw`, `plugins`) are denied, and
  elevated mode is off. Full exec can still edit files it owns, so this is a guard rail, not a
  boundary. Use a spend-limited Anthropic key made only for Piña.
- Phone write commands (`calendar.add`, `reminders.add`) are off unless the owner runs
  `iphone-setup.sh --allow-phone-writes`.

## Maintaining the package

- Edit the source files, then regenerate and check the paste-in file:

  ```bash
  node pina/cloud/build-cloud-init.mjs
  node pina/cloud/build-cloud-init.mjs --check
  ```

- Validate the config against the exact release the image runs (Node 24 or newer):

  ```bash
  mkdir -p /tmp/pina-check/.openclaw
  sed -e 's/__OWNER_TELEGRAM_ID__/123456789/g' -e 's#__OWNER_TZ__#Europe/Prague#g' \
    pina/config/openclaw.json5 > /tmp/pina-check/.openclaw/openclaw.json
  HOME=/tmp/pina-check OPENCLAW_STATE_DIR=/tmp/pina-check/.openclaw \
    OPENCLAW_CONFIG_PATH=/tmp/pina-check/.openclaw/openclaw.json \
    OPENCLAW_GATEWAY_TOKEN=test-token-0123456789abcdef0123 TELEGRAM_BOT_TOKEN=1:a ANTHROPIC_API_KEY=x \
    npx -y openclaw@2026.10.4 config validate
  ```

- After changing `cloud-init.yaml`, republish the setup guide so its builder uses the new
  template (the guide fetches it as `cloud-init.txt`).
- To move to a newer OpenClaw, change `OPENCLAW_IMAGE` in `docker-compose.yml`, re-run the
  validation above with that version, and read its migration notes: 2026.10.4 itself moved
  `agents.list` to `agents.entries` and retired `TOOLS.md` and `HEARTBEAT.md`.

## Files

```text
pina/
  app/pina.html                  Piña app (claude.ai page)
  guide/pina-setup.html          Setup guide with the server-setup builder
  cloud/cloud-init.yaml          Generated paste-in server setup (do not edit by hand)
  cloud/build-cloud-init.mjs     Generator for cloud-init.yaml
  cloud/setup.sh                 One-time and re-runnable server setup
  cloud/iphone-setup.sh          Optional Tailscale + iPhone app pairing
  cloud/docker-compose.yml       The stack (plus docker-compose.iphone.yml for the iPhone route)
  cloud/Dockerfile               Official image + gog
  cloud/install-gog.mjs          gog installer with checksum check
  config/openclaw.json5          Gateway config template (validated with 2026.10.4)
  workspace/                     Piña's home: AGENTS.md, SOUL.md, MEMORY.md, USER/IDENTITY
                                 templates, skills/iphone, skills/google-connect
  ios-phone-access.md            Permission gap in this fork's own iOS build (not the App Store app)
```

## Limits

- No app can tap buttons, read other apps' screens or open other apps on an iPhone. The
  OpenClaw iPhone app's screen recording only captures its own screen.
- The OpenClaw gateway cannot run on an iPhone; that is why Piña gets a cloud server.
- The server setup has not been run end to end on a real server from this environment (no
  Docker daemon or cloud account was available). Config, compose files, scripts and the
  paste-in file were checked with the OpenClaw 2026.10.4 CLI, Docker Compose and syntax checks.
