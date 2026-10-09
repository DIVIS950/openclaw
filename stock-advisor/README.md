# Stock Advisor

Type a **company, product or person** (for example "Nvidia", "iPhone" or "Elon Musk"). The app:

1. Uses Claude to find the stocks behind it (iPhone → AAPL, plus suppliers you can switch to).
2. Gets the price, a 1-year chart, key numbers and news from Yahoo Finance.
3. Finds related **Polymarket** prediction markets and shows their odds.
4. Has Claude give a **Buy / Hold / Avoid** view with a plain-English explanation, bull and bear cases, risks and tips. The Polymarket odds are part of what Claude weighs.
5. The **Ideas** tab: give your budget, time horizon, risk level and interests. Claude searches the web for current conditions and suggests what to invest in.
6. Optional: **trade on Polymarket** from the app with your own wallet. This is off by default.

> This is an educational tool, not financial advice. AI can be wrong. Never invest money you can't afford to lose.

## Run it

You need Node.js 22.9 or newer and an Anthropic API key from https://console.anthropic.com/settings/keys.

```bash
cd stock-advisor
npm install
cp .env.example .env      # then paste your key into ANTHROPIC_API_KEY
npm start                 # open http://127.0.0.1:3000
```

Run the tests with `npm test`.

## Keys you need

| What | Key needed? | Where to get it |
| --- | --- | --- |
| Claude analysis | Yes: `ANTHROPIC_API_KEY` | console.anthropic.com |
| Stock data (Yahoo Finance) | No | – |
| Polymarket odds | No (public data) | – |
| Polymarket trading | Yes: **your own** wallet private key | Your Polymarket account |

No one can "give" you a Polymarket API key. The key comes from **your** wallet. The app uses your private key to create (or re-create) your Polymarket API credentials automatically.

## Turning on Polymarket trading (optional)

1. Make a Polymarket account and add USDC. Polymarket blocks some countries, so check that it's allowed where you live.
2. Export your private key:
   - Logged in with email: Polymarket → Settings → Export private key. Set `POLYMARKET_SIGNATURE_TYPE=1`, and set `POLYMARKET_FUNDER_ADDRESS` to the wallet address shown on your profile.
   - Using MetaMask or a similar wallet: export the key from the wallet. Use `POLYMARKET_SIGNATURE_TYPE=2` with `POLYMARKET_FUNDER_ADDRESS` if your funds sit in the Polymarket proxy wallet. Use `0` only if the wallet holds the USDC directly.
3. In `.env`, set `POLYMARKET_TRADING_ENABLED=true`, add `POLYMARKET_PRIVATE_KEY`, and set a per-order limit in `POLYMARKET_MAX_TRADE_USD` (default $25).
4. Restart the app. Each market now has a **Trade** button. You choose the outcome, price and number of shares, and you must tick a confirmation box. Orders above your limit are refused.

Safety: the private key stays on your machine, in `.env`, and `.env` is git-ignored. The server listens on `127.0.0.1` only, so nobody else on your network can place trades. Don't change `HOST` while trading is on.

## How it's built

- `server.js`: Express API (`/api/analyze`, `/api/ideas`, `/api/trade`, `/api/config`) that also serves the web page.
- `lib/claude.js`: Claude calls through the official Anthropic SDK, using structured JSON output, web search for ideas, and automatic fallback if a request is declined.
- `lib/stocks.js`: Yahoo Finance data through `yahoo-finance2`.
- `lib/polymarket.js`: Polymarket Gamma API search (read-only).
- `lib/trading.js`: Polymarket CLOB orders through `@polymarket/clob-client`.
- `public/`: plain HTML, CSS and JS with a Claude-style design and automatic dark mode.

Yahoo Finance's API is unofficial, so it can break now and then. If it does, update `yahoo-finance2` (`npm update yahoo-finance2`).
