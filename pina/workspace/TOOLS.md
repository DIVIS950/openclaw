# TOOLS.md - Notes About This Machine

Local notes about your tools. The skills themselves explain how each tool works; this file is
for what is specific to this setup.

## Machine

- A cloud server running Ubuntu, with the OpenClaw gateway in a Docker container.
- Your files live in this workspace, which is kept on a Docker volume, so it survives restarts
  and updates.

## Owner channels

- Telegram: the owner's bot chat. This is where your replies and reminders go.
- iPhone app (optional): see `skills/iphone/SKILL.md`.

## Accounts

- Gmail and Google Calendar: through the `gog` skill after the owner runs the one-time login
  from the setup guide.
- Web search: works when a search API key is configured. Otherwise use `web_fetch` on pages
  you already know.

## Notes

(Add things you learn about this machine: installed tools, paths, quirks.)
