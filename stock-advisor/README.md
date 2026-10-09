# Stock Advisor

Type a **company, product or person** (for example "Nvidia", "iPhone" or "Elon Musk") and get an **AI Overview** from your advisor. The overview builds up live:

1. Each step shows as it runs: finding the stock (iPhone → AAPL, plus suppliers you can switch to), reading the numbers and news from Yahoo Finance, and checking **Polymarket** odds.
2. The price counts up, the 1-year chart draws itself, and the odds bars fill in as the data arrives.
3. Claude's verdict appears (**Buy / Hold / Avoid**, with a confidence meter) and the explanation types out in plain English.
4. Then come **What I'd do** (concrete steps for you), **Watch for** (events that would change the advice), bull and bear cases, risks and tips.

Set your **risk level** and **time horizon** next to the search box. The advice is tailored to them, and your browser remembers them.

The **Ideas** tab: give your budget, horizon, risk and interests. Claude searches the web for current conditions and suggests what to invest in.

**Advice only.** The app never places trades or touches your money. You decide and buy through your own broker. Polymarket odds are shown for information only, and reading them needs no key.

> This is an educational tool, not financial advice. AI can be wrong. Never invest money you can't afford to lose.

## Run it

You need Node.js 22.9 or newer and an Anthropic API key from https://console.anthropic.com/settings/keys. That's the only key you need.

```bash
cd stock-advisor
npm install
cp .env.example .env      # then paste your key into ANTHROPIC_API_KEY
npm start                 # open http://127.0.0.1:3000
```

Run the tests with `npm test`. Animations are turned off automatically if your device has "reduce motion" on.

## How it's built

- `server.js`: Express API that also serves the web page. `/api/analyze` streams progress and results live (Server-Sent Events); `/api/ideas` returns the investing ideas.
- `lib/claude.js`: Claude calls through the official Anthropic SDK, using structured JSON output, web search for ideas, and automatic fallback if a request is declined.
- `lib/stocks.js`: Yahoo Finance data through `yahoo-finance2`.
- `lib/polymarket.js`: Polymarket Gamma API search (read-only).
- `public/`: plain HTML, CSS and JS with a Claude-style design, animations and automatic dark mode.

Yahoo Finance's API is unofficial, so it can break now and then. If it does, update `yahoo-finance2` (`npm update yahoo-finance2`).
