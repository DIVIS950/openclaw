# 🍍 Pinaple — your personal AI assistant

Pinaple is your own AI assistant. It lives on its own computer in the cloud,
is online 24/7, and you talk to it in **Telegram**, like texting a friend.

Pinaple runs on top of [OpenClaw](https://docs.openclaw.ai), an open-source
assistant engine. This folder gives OpenClaw the Pinaple name, personality and
safe settings, plus a one-command installer.

## What Pinaple can do

- Chat with you in Telegram, in your language.
- Use its own computer: search the web, open websites, run programs, write files.
- Remember you: it keeps notes about you and your projects.
- Text you first: "remind me tomorrow at 8", "every Monday send me my plan".
- Understand voice messages (optional, see below).
- Call you on the phone (optional add-on, see below).
- Connect to more services later (email, calendar, GitHub, smart home...).

## What it costs

| Part | Price |
| --- | --- |
| Server (Oracle Cloud Always Free) | $0 |
| Telegram bot | $0 |
| The brain (Anthropic API) | pay per use, you control the limit |
| Phone calls (Twilio, optional) | a few $ per month + per minute |

Tip: set a monthly spending limit in the Anthropic Console so you never get a surprise bill.

## Setup (about 30 minutes)

### Step 1: get your two keys

1. **Anthropic API key** (the brain): go to https://console.anthropic.com,
   add credits, then **API Keys → Create Key**. It starts with `sk-ant-`.
2. **Telegram bot token** (free): in Telegram open **@BotFather**,
   send `/newbot`, pick a name (for example `Pinaple`) and a username
   ending in `bot`. Copy the token it gives you.

Keep both secret. Never post them anywhere.

### Step 2: get a free server

Create an **Oracle Cloud Always Free** account: https://www.oracle.com/cloud/free/

Then create a VM: **Compute → Instances → Create Instance**

- Image: **Ubuntu 24.04**
- Shape: **VM.Standard.A1.Flex** (Ampere ARM), 2 OCPU, 12 GB RAM
- Add your SSH key, click **Create**, and note the public IP.

If Oracle says "Out of capacity", try another availability domain or try later.
Any other Ubuntu server works too (Hetzner is about €4/month and has no waiting).

### Step 3: install Pinaple

Connect to the server and run:

```bash
ssh ubuntu@YOUR_SERVER_IP
git clone -b pinaple https://github.com/DIVIS950/openclaw.git
cd openclaw/pinaple
bash install.sh
```

Paste your two keys when asked. The installer:

- installs Node.js 24 and the OpenClaw engine,
- saves your keys privately in `~/.openclaw/.env`,
- installs Pinaple's config and personality,
- starts Pinaple as a background service that survives reboots.

### Step 4: say hi

1. In Telegram, send any message to your bot. It replies with a **pairing code**.
2. On the server, approve yourself (only once):

   ```bash
   openclaw pairing list telegram
   openclaw pairing approve telegram <CODE>
   ```

3. Talk to Pinaple. On the first chat it asks your name, timezone and what you need.

Only people you approve can talk to Pinaple. Strangers get nothing.

## Everyday commands (on the server)

```bash
openclaw status              # is Pinaple healthy?
openclaw logs --follow       # watch what it is doing
openclaw gateway restart     # restart Pinaple
openclaw doctor              # find and fix problems
sudo npm install -g openclaw@latest && openclaw gateway restart   # update
```

## Make Pinaple yours

Pinaple's personality lives in `~/.openclaw/workspace/` on the server:

- `SOUL.md` — how Pinaple talks and behaves, plus safety rules.
- `IDENTITY.md` — name and emoji.
- `USER.md` — what Pinaple knows about you. It updates this itself.

Edit them with `nano ~/.openclaw/workspace/SOUL.md`. Changes apply from the next message.

Want a smarter (more expensive) brain? Edit `~/.openclaw/openclaw.json` and change
`claude-sonnet-5-5` to `claude-opus-5-5`, then run `openclaw gateway restart`.

## Optional add-ons

### Voice messages

Claude cannot hear audio by itself. Add a speech key to `~/.openclaw/.env`, for example
`GROQ_API_KEY=...` (Groq has a free tier) or `OPENAI_API_KEY=...`, then restart.
Pinaple then understands your Telegram voice messages.
Docs: https://docs.openclaw.ai/nodes/audio

An `OPENAI_API_KEY` also unlocks smart memory search. Turn it on with
`openclaw config set memory.search.enabled true`.

### Phone calls

Pinaple can call you and you can call Pinaple, through Twilio (paid).

1. Create a Twilio account and buy a phone number.
2. Add to `~/.openclaw/.env`:
   ```
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   OPENAI_API_KEY=sk-...
   ```
3. Twilio must reach your server from the internet. The easy free way is
   Tailscale Funnel: https://tailscale.com/kb/1223/funnel
4. Put your numbers into `extras/voice-call.patch.json5`, then run:
   ```bash
   openclaw plugins install @openclaw/voice-call
   openclaw config patch --file extras/voice-call.patch.json5
   openclaw gateway restart
   openclaw voicecall setup
   ```

Docs: https://docs.openclaw.ai/plugins/voice-call

### More channels

Pinaple also works in WhatsApp, Discord, Signal, Slack and more.
Docs: https://docs.openclaw.ai/channels

## Safety

- Your keys stay on your server in `~/.openclaw/.env`. Never commit that file.
- Pinaple asks before it spends money, messages other people, or deletes things.
- The dashboard is private by default. Open it safely with an SSH tunnel:
  `ssh -L 18789:127.0.0.1:18789 ubuntu@YOUR_SERVER_IP`, then visit http://127.0.0.1:18789.
  The login token is the `OPENCLAW_GATEWAY_TOKEN` value in `~/.openclaw/.env`.
