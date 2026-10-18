# 🍍 Pinaple — your personal AI assistant

Pinaple is your own AI assistant. It lives on its own computer in the cloud,
is online 24/7, and you talk to it in **WhatsApp** or **Telegram**, like texting a friend.
It answers with text **and its own voice**.

Pinaple runs on top of [OpenClaw](https://docs.openclaw.ai), an open-source
assistant engine. This folder gives OpenClaw the Pinaple name, personality, voice
and safe settings, plus a one-command installer.

## What Pinaple can do

- Chat with you in WhatsApp or Telegram, in your language.
- **Talk:** every answer also comes as a voice message.
- **Listen:** send it a voice message and it understands you (free Groq key).
- Use its own computer: search the web, open websites, run programs, write files.
- Remember you: it keeps notes about you and your projects.
- Text you first: "remind me tomorrow at 8", "every Monday send me my plan".
- Call you on the phone (optional add-on, see below).

## What it costs

| Part | Price |
| --- | --- |
| Server (Oracle Cloud Always Free) | $0 |
| WhatsApp / Telegram | $0 |
| Pinaple's voice (Microsoft voice) | $0 |
| Understanding your voice messages (Groq) | $0 on the free tier |
| The brain (Anthropic API) | pay per use, you control the limit |
| Phone calls (Twilio, optional) | a few $ per month + per minute |

Tip: set a monthly spending limit in the Anthropic Console so you never get a surprise bill.

## Setup (about 30 minutes)

### Step 1: get your keys

1. **Anthropic API key** (the brain, required): go to https://console.anthropic.com,
   add credits, then **API Keys → Create Key**. It starts with `sk-ant-`.
2. **Groq API key** (hearing, optional but recommended, free): go to
   https://console.groq.com/keys and create a key. It starts with `gsk_`.
3. **Telegram bot token** (only if you want Telegram, free): in Telegram open
   **@BotFather**, send `/newbot`, pick a name and a username ending in `bot`.

WhatsApp needs no key. You link it with a QR code, like WhatsApp Web.

Keep all keys secret. Never post them anywhere.

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

The installer asks you:

1. Your Anthropic key.
2. Where to chat: **1** WhatsApp, **2** Telegram, **3** both.
3. Your WhatsApp number with country code, for example `+420601234567`.
4. Your Telegram bot token, only if you chose Telegram.
5. Your Groq key, or press Enter to skip.

Then it installs everything and starts Pinaple as a background service that survives reboots.

### Step 4: link WhatsApp and test

At the end the installer shows a **QR code** in the terminal.

1. On your phone open **WhatsApp → Settings → Linked devices → Link a device**.
2. Scan the QR code. Make the terminal window big so the code fits.
3. In WhatsApp open the chat with yourself (**"Message yourself"**, your own name at the top of the contact list).
4. Write: `Hi Pinaple!` You get an answer with text and a voice message.
5. Hold the microphone button and speak. Pinaple understands you if you added a Groq key.

Pinaple only answers in your own "Message yourself" chat. It never replies to
your friends, family or groups.

QR code expired or you skipped it? Run `openclaw channels login --channel whatsapp`
and then `openclaw gateway restart`.

### Telegram test (if you chose it)

1. Send any message to your bot. It answers with a pairing code.
2. On the server approve yourself (only once):

   ```bash
   openclaw pairing list telegram
   openclaw pairing approve telegram <CODE>
   ```

## Voice controls (type in the chat)

| Command | What it does |
| --- | --- |
| `/tts off` | text only |
| `/tts on` | voice messages again |
| `/tts status` | show voice settings |

The voice is Microsoft's free "Andrew Multilingual", which speaks your language.
To change it, edit `speakerVoice` in `~/.openclaw/openclaw.json` and restart.
For a more natural voice you can switch to ElevenLabs or OpenAI (paid):
https://docs.openclaw.ai/tools/tts

## Everyday commands (on the server)

```bash
openclaw status              # is Pinaple healthy?
openclaw logs --follow       # watch what it is doing
openclaw gateway restart     # restart Pinaple
openclaw doctor              # find and fix problems
sudo npm install -g openclaw@latest && openclaw gateway restart   # update
```

To change your answers (apps, number, keys), edit `~/.openclaw/.env` and run
`bash install.sh` again. It keeps Pinaple's memory.

## Make Pinaple yours

Pinaple's personality lives in `~/.openclaw/workspace/` on the server:

- `SOUL.md` — how Pinaple talks and behaves, plus safety rules.
- `IDENTITY.md` — name and emoji.
- `USER.md` — what Pinaple knows about you. It updates this itself.

Edit them with `nano ~/.openclaw/workspace/SOUL.md`. Changes apply from the next message.

Want a smarter (more expensive) brain? Edit `~/.openclaw/openclaw.json` and change
`claude-sonnet-5-5` to `claude-opus-5-5`, then run `openclaw gateway restart`.

## Optional: phone calls

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

## Safety

- Your keys stay on your server in `~/.openclaw/.env`. Never commit that file.
- Pinaple asks before it spends money, messages other people, or deletes things.
- WhatsApp works like WhatsApp Web: the server becomes a linked device of your account.
  You can remove it any time in **WhatsApp → Linked devices**.
- WhatsApp does not officially allow bots on personal accounts. Small personal use is
  common, but if you worry about your number, use a second SIM just for Pinaple.
- The dashboard is private by default. Open it safely with an SSH tunnel:
  `ssh -L 18789:127.0.0.1:18789 ubuntu@YOUR_SERVER_IP`, then visit http://127.0.0.1:18789.
  The login token is the `OPENCLAW_GATEWAY_TOKEN` value in `~/.openclaw/.env`.
