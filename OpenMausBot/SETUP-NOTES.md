# OpenMausBot: local web app setup (this checkout)

- Start: `./start-web.sh` (serves the web UI on http://127.0.0.1:8799, loopback only).
- Sign in: open http://127.0.0.1:8799/pair and type the code the server printed.
  New code any time: `./start-web.sh pair` (single use, expires in 5 minutes).
- Data lives in `.omb-data/` (chats, config, API keys as 0600 `config.json`). Back it up, never commit it.
- Connect an AI engine after sign-in: Settings -> Engines (Claude / Codex login) or
  Settings -> Connections -> Model providers (API key).
- Only you: the server binds 127.0.0.1 only, browsers must pair, and any extra device needs
  its own pairing code. Do not set OMB_PUBLIC_URL, --tunnel, --tailscale or --domain unless
  you want remote access.
- Security audit (pnpm audit --prod) done 2026-11-05: undici bumped to 8.12.2 and vite to 7.3.7.
  Remaining: source-map-js (docs site only), @vitest/mocker (tests only), katex low.
