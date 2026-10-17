---
summary: "Muse: an always-on OpenClaw AI computer on a Hetzner server, with a cloud browser you can watch, WhatsApp and Telegram, and the Muse Sentinel approval guard"
read_when:
  - You want a personal AI computer in the cloud that keeps working when your phone is locked
  - You want OpenClaw to drive a real browser that you can watch and take over from your phone
  - You want the agent to ask you before it sends, posts, books, buys or deletes anything
title: "Muse"
---

# Muse: your AI computer in the cloud

Muse turns one small Hetzner server into your own AI computer. It runs all the time.
You give it jobs from WhatsApp, Telegram, a private web page or the Pineapple iPhone app.
It works in its own Chromium browser, and you can watch that browser live from your phone.
Before it does anything that leaves the server, it asks you.

One command installs everything. This page explains what you get, what it costs, how to install it and how to use it safely.

## What you get

Muse runs three containers on one server:

- **gateway**: OpenClaw with Claude. It answers on WhatsApp, Telegram, the web chat and the chat API. It also runs the Muse Sentinel plugin.
- **desktop**: a Chromium browser on a virtual screen. Muse drives it. You watch it or take it over. Logins stay saved between jobs.
- **caddy**: the front door. It gets an HTTPS certificate on its own and serves the web chat and the desktop page.

```text
your phone or laptop
        |
        |  HTTPS (port 443)
        v
      caddy ----- /desktop/* (needs the watch key) -----> desktop: Chromium + noVNC
        |                                                      ^
        |  everything else                                     |  CDP (private network only)
        v                                                      |
     gateway: OpenClaw + Claude + Muse Sentinel ---------------+
```

The **Muse Sentinel** is a guard plugin. It checks every tool call before it runs.
Reading, searching and browsing go through. Sending, posting, submitting forms, booking, buying and deleting wait for your OK on your phone.

All channels share one conversation. A job you start on WhatsApp can be followed up in the web chat.

## What it costs

- **Server**: a Hetzner Cloud server with 2 vCPUs and 4 GB RAM is enough. 8 GB is more comfortable when the browser has many tabs open. Small plans cost a few euros a month; check the current price list on the Hetzner website. The public IPv4 address is billed separately and is needed.
- **Claude**: you pay Anthropic per use with your own API key. Browser work reads whole pages, so long jobs use more tokens than chat. Set a monthly spend limit in the Anthropic Console.
- **Guard model**: the Sentinel asks a small, separate Claude model about unclear clicks. It adds little to the bill.
- **Domain**: optional. Without one, Muse uses a free `sslip.io` name made from the server IP.
- **WhatsApp and Telegram**: free.

## What you need

- A Hetzner Cloud account (any similar Ubuntu or Debian server works too).
- An Anthropic API key from the Anthropic Console.
- Optional: a domain name you can point at the server.
- Optional: a Telegram bot token from @BotFather, and your numeric Telegram user id (for example from @userinfobot).
- Optional: your WhatsApp number with country code.
- About 20 minutes. The first build takes 5 to 10 minutes of that.

## Install on Hetzner

<Steps>
  <Step title="Create the server">
    In the Hetzner Cloud Console, create a server:

    - Image: Ubuntu 24.04 or Debian 12.
    - Type: x86 (Intel or AMD), 2 vCPUs, 4 GB RAM or more. Arm servers are not tested.
    - Networking: keep the public IPv4 address.
    - SSH key: add yours.

    If you attach a Hetzner Cloud Firewall, allow TCP 22, 80 and 443 (and UDP 443). The installer also sets up `ufw` on the server with the same ports.

  </Step>

  <Step title="Point your domain (optional)">
    If you want your own name, create a DNS `A` record such as `muse.example.com` that points to the server IPv4 address. Do this before you install, so Caddy can get the certificate.

    Without a domain, Muse uses a name like `203-0-113-10.sslip.io`. It points to your server IP and needs no setup.

  </Step>

  <Step title="Run the installer">
    Log in and run one command as root:

```bash
ssh root@<server-ip>
curl -fsSL https://raw.githubusercontent.com/divis950/openclaw/muse-cloud/deploy/muse/install.sh | bash
```

    It asks for:

    - your Anthropic API key (hidden while you type)
    - your domain (press Enter to use the `sslip.io` name)
    - your Telegram bot token, then your Telegram user id (press Enter to skip Telegram)
    - your WhatsApp number, for example `+15555550123` (press Enter to skip WhatsApp)

  </Step>

  <Step title="Save the links">
    At the end the installer runs `muse info`. It prints:

    - the web chat link: `https://<your-site>/#token=<gateway token>`
    - the live desktop link: `https://<your-site>/desktop/?key=<watch key>`
    - a QR code for the Pineapple app

    Treat both links like passwords. You can print them again any time with `muse info`.

  </Step>
</Steps>

### What the installer does

1. Installs Docker, git, Python 3, `qrencode` and `ufw`.
2. Opens the firewall for SSH, HTTP and HTTPS only.
3. Downloads the code to `/opt/muse/openclaw`.
4. Writes your settings and secrets to `/srv/muse/muse.env` (readable by root only).
5. Generates the OpenClaw config `/srv/muse/openclaw/openclaw.json` from that file. Secrets are not copied into it; the containers read them from the environment.
6. Writes the Muse persona (`AGENTS.md`, `IDENTITY.md`) into the agent workspace if they are missing.
7. Installs the `muse` helper command.
8. Builds and starts the containers, waits for the health check, and runs `muse doctor`.

Run it again at any time. It reuses `/srv/muse/muse.env` and only asks for what is missing.

### Install without questions

Set the answers as environment variables first. `MUSE_YES=1` takes the defaults for everything you do not set.

```bash
read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
export MUSE_DOMAIN=muse.example.com MUSE_WHATSAPP_OWNER=+15555550123 MUSE_YES=1
curl -fsSL https://raw.githubusercontent.com/divis950/openclaw/muse-cloud/deploy/muse/install.sh | bash
```

| Variable                   | Meaning                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`        | Required. Your Anthropic API key.                                              |
| `MUSE_DOMAIN`              | Your domain. Empty means the `sslip.io` name.                                  |
| `TELEGRAM_BOT_TOKEN`       | Turns on Telegram.                                                             |
| `MUSE_TELEGRAM_OWNER`      | Your numeric Telegram user id.                                                 |
| `MUSE_WHATSAPP_OWNER`      | Your WhatsApp number with country code. Turns on WhatsApp.                     |
| `MUSE_MODEL`               | Main model. Default `anthropic/claude-opus-5-5`.                               |
| `MUSE_GUARD_MODEL`         | Model the Sentinel asks about unclear clicks. Default `claude-haiku-5-5`.      |
| `MUSE_SENTINEL_MODE`       | `outbound` (default), `money` or `off`. See [Sentinel modes](#sentinel-modes). |
| `MUSE_REPO`, `MUSE_BRANCH` | Where the code comes from.                                                     |
| `MUSE_YES`                 | `1` means never ask.                                                           |

## First steps

### Open the web chat

1. Open the web chat link from `muse info` on your laptop or phone.
2. The first time, a new browser sees "pairing required". On the server, run:

```bash
muse approve-device
```

3. Reload the page. This browser is now remembered.

`muse approve-device` approves the newest waiting device. Run it right after you open the page yourself, so you approve your own browser and nobody else.

The web chat is the OpenClaw [Control UI](/web/control-ui). It also shows channel status and sessions.

### Link WhatsApp

Muse uses your own WhatsApp account as a linked device. You talk to it in the **Message yourself** chat. Messages from anyone else are ignored.

1. If you skipped WhatsApp during install, set your number first: `muse whatsapp-owner +15555550123`.
2. Run `muse whatsapp`. A QR code appears in the terminal.
3. On your phone, open WhatsApp, go to **Linked devices** (in Settings on iPhone, in the menu on Android), tap **Link a device**, and scan it.
4. The helper restarts the gateway. Send "hello" in the **Message yourself** chat.

You can also link from the Channels page of the web chat. See [WhatsApp](/channels/whatsapp) for details.

### Set up Telegram

1. Create a bot with @BotFather and copy the token. Give it to the installer (run it again if you skipped Telegram).
2. Set your numeric user id: `muse telegram-owner 123456789`. Only this id can talk to the bot and approve actions.
3. Send your bot any message once. Telegram bots cannot write to you first, so this is needed before approval prompts can reach you.

Do not know your id? Without an owner id, the bot answers the first message with your user id and a pairing code. Use that id with `muse telegram-owner`. See [Telegram](/channels/telegram) for details.

### Check that it works

```bash
muse doctor
```

It asks Claude to reply "OK", then asks Muse to open a web page in its browser and tell you the title.
If the configured model does not work on your account, `muse doctor` switches to `anthropic/claude-opus-4-6` and tries again.

## The desktop page

Open the live desktop link from `muse info`. The first visit stores the watch key in a cookie, so later visits from the same browser work without the key.

The page shows:

- **The live screen.** You watch what Muse does in its browser. The screen is 1024 x 1400 pixels, tall like a phone, so it is easy to follow.
- **Take over.** Pauses Muse and gives you the mouse and keyboard. Use it to log in to sites, solve a CAPTCHA, or look around.
- **Give back.** Hands the browser back to Muse.
- **Approvals.** Actions waiting for your OK, each with **Allow** and **Don't** buttons.

Logins you make in this browser stay saved in its profile. A good habit: take over, log in to the sites you want Muse to use, then give the browser back.

## Approvals

### What needs your OK

The Sentinel looks at each tool call before it runs.

Goes through without asking:

- reading web pages, searching, opening and switching tabs, taking screenshots
- scrolling, hovering, typing into a field, filling a form without sending it
- clicking links and harmless buttons (search, next, close, menu, cookie banners, sign in)
- reading and writing files in the Muse workspace
- messages to you, and replies in the chat you are using

Waits for your OK:

- messages to anyone other than you
- uploading a file, or accepting a browser dialog
- clicks and form submits that send, post, buy, book, pay, subscribe, delete or change something
- tools from other plugins

Always blocked on a Muse server: the shell, the gateway and its config, scheduled jobs, device control, sending work to other sessions, and running JavaScript in the browser.

For unclear clicks (a button called "Continue", a form submit with Enter), the Sentinel asks a separate, small Claude model. That model sees only the one action and the page around it, and treats page text as untrusted. If it says the action is harmless, Muse goes ahead. If it is unsure, or cannot be reached, you are asked. The Sentinel knows risky button words in English and Czech.

If anything goes wrong inside the Sentinel, the action is blocked.

### Approve or say no

When an action needs you, Muse stops and tells you in one sentence what it is waiting for. At the same time the Sentinel asks you directly:

- **Telegram**: a message with **✅ Allow** and **❌ Don't** buttons.
- **WhatsApp**: a message with a 6-digit code that says `Reply /ok CODE to allow or /no CODE to stop.`
- **Desktop page**: the action shows up with **Allow** and **Don't** buttons.
- **Pineapple**: while it runs a job on Muse, it asks you in the app.

What happens next:

- `/ok CODE` (or **Allow**): Muse is told you approved and continues. It may do exactly that action once: the same button, text and recipient.
- `/no CODE` (or **Don't**): Muse is told no. The same action stays blocked for the rest of the approval window.
- Requests you do not answer expire after 30 minutes. An approval that Muse does not use expires after 10 minutes.

Only you can approve. Approvals count only from your own Telegram or WhatsApp chat, the desktop page and Pineapple. The web chat refuses `/ok`. On Telegram only the buttons work, and a code works only when you type it in WhatsApp. If you quote-reply to an approval message, Muse can read the quoted text, so answer an approval with `/ok` or `/no` (or the buttons), not with a question quoting it.

To see what is waiting from the server, run `muse pending`.

### Sentinel modes

| Mode       | What Muse asks about                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `outbound` | Default. Anything that leaves the server, as listed above.                                                                  |
| `money`    | Only payments and purchases: pay, buy, order, checkout, subscribe, donate, transfer, prices. Messages and posts go through. |
| `off`      | Nothing. The always-blocked tools stay blocked.                                                                             |

To change it, see [Change settings](#change-settings).

## Pause and take over

While you use the browser, Muse must keep its hands off. Pause it in any of these ways:

- **Take over** on the desktop page
- `/pause` in your Telegram or WhatsApp chat with Muse
- `muse pause` on the server

While paused, Muse may still look at the browser (screenshots, page text, the tab list), but it cannot click, type or open pages. It is told that you have the browser and that it should wait.

To give it back, use **Give back**, `/resume` or `muse resume`. After `/resume` in chat, Muse is told it has the browser again and continues its job. After **Give back** on the desktop page, send Muse a message if it was waiting for you.

## Pair the Pineapple app

Pineapple is an iPhone app with Claude inside. It can hand long jobs to Muse: web work that takes a while, sites where you are logged in on Muse, and anything that must keep running when the phone is locked.

1. On the server, run `muse info`. It shows a QR code at the end.
2. Point the iPhone Camera at the code and open the link in Pineapple.
3. Pineapple saves the server address, the gateway token and the watch key in the iPhone Keychain.
4. In Pineapple **Settings > Cloud computer**, tap **Test connection**. **Open live desktop** shows the desktop page.

Pineapple talks to Muse through the [OpenAI-compatible chat API](/gateway/openai-http-api) in the same conversation as WhatsApp and Telegram. When a job needs your OK, Pineapple asks you in the app.

The QR code contains the gateway token and the watch key. Do not share a photo of it.

## Everyday commands

Run these as root on the server.

| Command                       | What it does                                                       |
| ----------------------------- | ------------------------------------------------------------------ |
| `muse info`                   | Web chat link, desktop link and the Pineapple QR code              |
| `muse status`                 | Show the containers                                                |
| `muse logs [service]`         | Follow the logs of `gateway`, `desktop` or `caddy`                 |
| `muse restart [service]`      | Restart everything or one container                                |
| `muse up` / `muse down`       | Build and start, or stop                                           |
| `muse health`                 | Gateway health check                                               |
| `muse doctor`                 | Check that Claude and the browser work                             |
| `muse approve-device`         | Approve the newest browser that wants to use the web chat          |
| `muse revoke-devices`         | Unpair every browser and app                                       |
| `muse sentinel-check`         | Check the approval guard runs (stops Muse if it does not)          |
| `muse whatsapp`               | Link WhatsApp with a QR code                                       |
| `muse whatsapp-owner +NUMBER` | Set your WhatsApp number                                           |
| `muse telegram-owner ID`      | Set your Telegram user id                                          |
| `muse model PROVIDER/MODEL`   | Change the main model                                              |
| `muse pause` / `muse resume`  | Keep Muse off the browser, then give it back                       |
| `muse pending`                | Actions waiting for your OK                                        |
| `muse update`                 | Get the latest code and rebuild                                    |
| `muse backup [file]`          | Back up settings, chats, the WhatsApp link and the browser profile |
| `muse cli ARGS`               | Run an OpenClaw command, for example `muse cli plugins list`       |

## Change settings

Settings live in `/srv/muse/muse.env`. The OpenClaw config is generated from it, so do not edit `openclaw.json` by hand; your changes would be overwritten.

- Owners and model have their own commands: `muse whatsapp-owner`, `muse telegram-owner`, `muse model`.
- For anything else (for example `MUSE_SENTINEL_MODE`, `MUSE_GUARD_MODEL` or a Telegram token you skipped), edit `muse.env` and run the installer again from the checkout:

```bash
MUSE_YES=1 /opt/muse/openclaw/deploy/muse/install.sh
```

It keeps your settings, rewrites the config and restarts Muse.

The installer writes `muse.env` with its own list of keys. Lines it does not know are dropped when it runs again.

## Security model

Muse is built for one owner. Read [Security](/gateway/security) for the general OpenClaw trust model.

### What protects you

- **Two secrets.** The gateway token gives full access to Muse: web chat, chat API and approvals. The watch key gives access to the desktop page, which can watch and control the browser and approve actions. Both are random and live in `/srv/muse/muse.env` (root only), in the links `muse info` prints, and in the environment of the containers that need them. Caddy keeps its config in memory only.
- **Few open ports.** Only SSH, HTTP and HTTPS are open. The browser control port (CDP) and the VNC server are on a private Docker network. CDP accepts only the gateway address.
- **Blocked paths.** Caddy does not expose `/tools/invoke` or `/hooks`. The gateway also refuses browser, messaging, shell and config tools on `/tools/invoke`.
- **A small toolbox.** The agent has no shell, cannot change the config, cannot schedule jobs, and cannot start other agents. File tools only reach the workspace. Browser JavaScript is turned off. Chat commands such as `/config`, `/bash` and `/restart` are turned off.
- **A guard that cannot be swapped.** The Sentinel and the WhatsApp and Telegram plugins load from fixed paths in the image, no other plugin may load, and the plugin folder in the workspace is locked, so a file in the workspace cannot replace them. The Sentinel runs last among the tool checks, so its decision wins, and it blocks when it fails.
- **No private addresses.** The browser does not open private or local network addresses, and the server blocks the containers from the cloud metadata service.
- **Approvals only from you.** Codes go to your phone, are checked against your Telegram id or WhatsApp number, are used once, and expire.
- **Secrets stay out of the config.** The API key, gateway token and bot token reach the containers as environment variables.

### What it does not protect

- **Reading is allowed.** Muse can open any public page. A page that tricks Muse could make it open an address that carries data in the URL. A page can also redirect the browser to an internal address, such as the desktop itself, and Muse can read what loads there. Do not keep secrets in the cloud browser that you would not want to leak.
- **Logins live on the server.** The browser profile holds your cookies. Anyone with root on the server, or with the watch key, can use those logins.
- **WhatsApp runs on your number.** The server holds your WhatsApp session. Approved messages go out as you.
- **The guard can be wrong.** Word lists and a small model judge unclear clicks. Read approval prompts before you tap Allow. Mode `off` turns approvals off.
- **You approve what you approve.** Muse does exactly what you allowed.
- **The cloud browser has no Chromium sandbox.** Chromium runs in its own container with `--no-sandbox`. A browser exploit would reach that container, which holds your saved logins.

To change a secret, delete its line (`OPENCLAW_GATEWAY_TOKEN` or `MUSE_WATCH_KEY`) from `muse.env` and run the installer again. It makes a new one. After a new gateway token, run `muse revoke-devices`: browsers that were already paired keep working otherwise. Then pair your browser and Pineapple again with the new links from `muse info`.

## Troubleshooting

<AccordionGroup>
  <Accordion title="The site does not load or has no certificate">
    - Check that ports 80 and 443 are open in any Hetzner Cloud Firewall.
    - With your own domain, check that its `A` record points to the server IPv4 address.
    - Look at `muse logs caddy`.
    - Open the site by its name (`https://<your-site>`), not by IP address.
  </Accordion>

  <Accordion title="The web chat says pairing required">
    Run `muse approve-device` on the server, then reload the page. Each new browser needs this once.
  </Accordion>

  <Accordion title="The web chat says the origin is not allowed">
    The web chat only works on the exact site name from the installer. To change the name, set `MUSE_DOMAIN` in `muse.env` to the new name and run the installer again.
  </Accordion>

  <Accordion title="Claude does not answer">
    - Run `muse doctor`. It also tries a fallback model.
    - Check that the API key is valid and the Anthropic account has credit.
    - Look at `muse logs gateway`.
  </Accordion>

  <Accordion title="The browser does not work">
    - Run `muse logs desktop`, then `muse restart desktop`.
    - If Muse says the owner has the browser, it is paused. Run `muse resume`.
  </Accordion>

  <Accordion title="The desktop page says to open the link from the installer">
    This browser has no watch cookie yet. Open the desktop link from `muse info` once.
  </Accordion>

  <Accordion title="WhatsApp does not answer">
    - Write in the **Message yourself** chat, from the number set as owner.
    - Link again with `muse whatsapp`.
    - Check `muse logs gateway` for WhatsApp errors.
  </Accordion>

  <Accordion title="The Telegram bot ignores me">
    - Check your numeric user id and set it with `muse telegram-owner`.
    - Usernames do not work; only the number does.
  </Accordion>

  <Accordion title="No approval prompts arrive">
    - Telegram: send your bot a message once so it may write to you.
    - WhatsApp: the account must be linked and online.
    - Run `muse pending` to see waiting actions, and approve them on the desktop page.
    - If `muse pending` does not print JSON with `paused` and `pending`, the Sentinel is not loaded. Check `muse logs gateway` for `muse-sentinel`.
  </Accordion>

  <Accordion title="The first build fails or the server freezes">
    The build needs memory. Use a server with at least 4 GB RAM, then run `muse up` again.
  </Accordion>
</AccordionGroup>

## Updating

```bash
muse update
```

This pulls the latest code into `/opt/muse/openclaw`, regenerates the config from `muse.env`, rebuilds the images and restarts the containers. Your settings, chats, WhatsApp link and browser logins stay. The persona files in the workspace are kept; delete one and run `muse update` to get the current default back.

Make a backup before big updates.

## Backup

```bash
muse backup
```

This stops the desktop for a moment and writes one file, for example `/root/muse-backup-20260101-120000.tar.gz`. It contains:

- `/srv/muse`: settings and secrets, the OpenClaw config, chats, memory, the workspace, the WhatsApp link and pending approvals
- the browser profile (the `muse_chrome` Docker volume): logins, cookies and history

The file holds your secrets and logins. Copy it somewhere safe and encrypted, then delete it from the server:

```bash
scp root@<server-ip>:/root/muse-backup-*.tar.gz .
```

Hetzner server backups and snapshots are a good second layer.

### Restore

On a new server with the same site name:

1. Run the installer once, so Docker, the code and the `muse` command exist.
2. Copy the backup file to the server and restore it:

```bash
muse down
mkdir -p /root/restore
tar xzf /root/muse-backup-<date>.tar.gz --numeric-owner -C /root/restore
cp -a /root/restore/data/muse/. /srv/muse/
docker run --rm -v muse_chrome:/data/chrome -v /root/restore/data/chrome:/from:ro busybox \
  sh -c 'cp -a /from/. /data/chrome/'
muse up
rm -rf /root/restore
```

The `sslip.io` name depends on the server IP. If you plan to move servers, use your own domain and point it at the new IP.

## Related

- [Hetzner (plain OpenClaw on Docker)](/install/hetzner)
- [Docker](/install/docker)
- [Browser tool](/tools/browser)
- [Plugins](/tools/plugin)
- [Control UI](/web/control-ui)
- [WhatsApp](/channels/whatsapp)
- [Telegram](/channels/telegram)
- [Security](/gateway/security)
