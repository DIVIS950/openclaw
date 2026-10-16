---
name: google-connect
description: "One-time setup that connects the owner's Gmail and Google Calendar to the gog CLI, entirely from this chat. Use when: the owner says connect or link my Gmail or Google Calendar, or gog reports no credentials or no account. NOT for: reading or sending mail once connected (use the gog skill)."
metadata: { "openclaw": { "emoji": "🔑", "requires": { "bins": ["gog"] } } }
---

# Connect Gmail and Google Calendar

`gog` keeps its settings and the encrypted login under `$GOG_HOME` (on the persistent state
volume). The keyring password is already in your environment as `GOG_KEYRING_PASSWORD`. Never
print it, and never show the contents of the client file or of any token.

## 0. Already connected?

Run `gog auth list --check` and read every entry it prints (its exit code alone proves nothing).
If the owner's account is listed as valid, say so and stop.

## 1. The Google "Desktop app" client file

The owner creates this once in Google Cloud Console, following the setup guide (Gmail API and
Calendar API enabled, consent screen published, OAuth client of type Desktop app). Ask them to
send you the downloaded `client_secret_….json` file here, or paste its text.

Save it as `$GOG_HOME/client_secret.json` with permissions 600, then run:

```bash
gog auth keyring file
gog auth credentials "$GOG_HOME/client_secret.json"
```

## 2. Sign-in link

Ask which Google address to connect, then run:

```bash
gog auth add <their address> --services gmail,calendar --remote --step 1
```

Send the owner the `auth_url` it prints, on its own line, with these instructions:

1. Open the link and pick your Google account.
2. If Google warns the app is unverified, tap Advanced, then continue. It is your own app.
3. Allow Gmail and Calendar access.
4. The last page will fail to load. That is expected. Tap the address bar, copy the whole
   address (it starts with `http://localhost` or `http://127.0.0.1`), and paste it here.

## 3. Finish

With the pasted address:

```bash
gog auth add <their address> --services gmail,calendar --remote --step 2 --auth-url '<pasted address>'
gog auth list --check
```

Use the same `--services` in both steps. If step 2 says the state expired, start again at step 2
of this skill.

When it works:

- Add a line to `MEMORY.md`: `Google account for gog: <address>`.
- From now on pass `--account <address>` to gog commands.
- Tell the owner in one sentence that Gmail and Calendar are connected, and offer to set up the
  morning briefing.

## Safety

- Sending mail, replying and changing calendar events still need the owner's clear "yes" (see
  Red Lines in `AGENTS.md`).
- If the owner wants to disconnect, tell them to remove the app at
  https://myaccount.google.com/permissions (Third-party apps with account access), then delete
  the line in `MEMORY.md`.
