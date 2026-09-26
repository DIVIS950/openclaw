# SnapSell

Snap a photo of anything you want to sell. AI identifies it, researches real market prices, polishes your photos, writes
the listing, and posts it to **eBay**, **Facebook Marketplace** and **Vinted**.

It's a phone-first web app (installable to your home screen) backed by a small Node server that runs on your computer.

## What it does

1. **Capture**: take photos with your phone camera (up to 12) and add an optional note ("battery 89%, box included").
2. **Identify**: Claude vision works out the exact item: brand, model, variant, size, and its honest condition.
3. **Price**: Claude searches the web live for sold and active listings in your country, then suggests a
   price range, a quick-sale price and a top price, with the comparable listings it found.
4. **Photo studio**: auto-crops to the item, fixes light, color and sharpness, and outputs square, marketplace-ready
   photos. Presets: *Auto*, *Vivid*, and *Studio* (an AI background cut-out on a clean white backdrop, run
   in the browser).
5. **Write**: a separate title and description for each marketplace, in your language: eBay (keyword-dense, 80
   characters), Facebook (short and friendly), Vinted (casual, with hashtags). Everything stays editable.
6. **Post**: one tap sends the listing to every marketplace you select. You can also use *copy & open* for
   any site.

## Quick start

```bash
cd apps/snapsell
npm install
npx playwright install chromium   # only needed if Google Chrome isn't installed
cp .env.example .env              # then put your ANTHROPIC_API_KEY in .env
npm run dev
```

Open http://localhost:5173. Without an API key the app runs in **demo mode** with sample data, so you can try the
whole flow for free.

### Use it on your phone

Your phone and computer must be on the same Wi-Fi. Run `npm run dev` and open `http://<your-computer-ip>:5173` on the
phone. In Safari use *Share → Add to Home Screen*; in Chrome use *Install app*.

For an always-on setup, build once and run the production server (one port, serves the app and the API):

```bash
npm run build
npm start          # http://<your-computer-ip>:8787
```

## Connecting marketplaces

### Facebook Marketplace and Vinted (browser automation)

These sites have no public listing API, so SnapSell drives a real Chrome window on your computer, logged in as you.

1. Go to **Settings → Marketplaces → Connect**. A browser window opens on the computer running SnapSell.
2. Log in normally (including 2FA). SnapSell detects the login, remembers the session in `data/browser/<site>`, and
   closes the window.
3. When you post, SnapSell opens the create-listing page, uploads the enhanced photos, and fills in title, price,
   category, condition and description.

By default **Auto-publish is off**: the form is filled in and left open so you can check it and press the final
Publish button yourself. Turn Auto-publish on in Settings to have SnapSell click it too.

> ⚠️ Automated posting is against these sites' terms and can trigger checks or restrictions on your account. SnapSell
> types at human speed and only acts when you ask it to, but the risk is yours. Keeping Auto-publish off is the safer
> choice. Site layouts change; if a field can't be found, SnapSell tells you what to finish by hand.

For Vinted, pick the right country in Settings (vinted.cz, vinted.de, vinted.co.uk …). Size and package size
depend on the category and may need a tap.

### eBay (official API)

eBay posting goes through eBay's official Sell APIs, so no browser is needed. One-time setup:

1. Create a developer account at https://developer.ebay.com and create a **Production** keyset (App ID = client id,
   Cert ID = client secret).
2. Under *User Tokens → Get a Token from eBay via Your Application*, sign in with your seller account and grant the
   `sell.inventory` scope. Copy the **refresh token** (it's valid for about 18 months).
3. In eBay Seller Hub, opt in to **Business Policies** and create a shipping, payment and return policy. Their IDs are in
   the policy URLs (or use the Account API `GET /sell/account/v1/fulfillment_policy`).
4. Create an inventory location once (`POST /sell/inventory/v1/location/{key}`) with your address; the `{key}` you
   choose is `EBAY_LOCATION_KEY`.
5. Fill the `EBAY_*` values in `.env` and restart. Settings then shows eBay as connected.

For a different eBay site, set `EBAY_MARKETPLACE_ID` (for example `EBAY_DE`) and `EBAY_CONTENT_LANGUAGE` (for example
`de-DE`). Use `EBAY_ENV=sandbox` with sandbox keys to test without real listings.

## How the AI works

`server/ai/analyze.ts` makes two Claude API calls:

1. **Research**: the photos, plus the `web_search` tool. Claude identifies the item and looks up sold and asking
   prices. The search queries it runs appear live on the "Analyzing" screen.
2. **Compose**: the photos plus the research report, returned as structured JSON (`shared/types.ts → AnalysisSchema`).
   This gives the price range, comparables, per-platform copy, item specifics, and a bounding box per photo for
   auto-crop.

The default model is `claude-opus-5`; override it with `SNAPSELL_MODEL`. Refusal fallbacks are enabled
(`fallbacks: "default"`). A listing typically costs roughly $0.10 to $0.40 in API usage (images, web searches and output), depending on how much research is needed.

## Project layout

```
server/            Hono API server (tsx)
  ai/              Claude analysis + demo data
  publish/         eBay (API), Facebook + Vinted (Playwright)
  store.ts         JSON + file storage under data/
shared/types.ts    Schema and types shared by server and app
src/               React app (Vite + Tailwind + Motion)
  lib/image.ts     Photo studio: crop, tone, sharpen, background removal
```

All data (listings, photos, browser sessions, settings) stays on your computer in `data/`.

## Notes

- The *Studio* preset uses `@imgly/background-removal`, which downloads a ~40 MB model the first time and runs on
  the device. That library is AGPL-licensed, which is fine for personal use; replace it before distributing SnapSell
  commercially.
- `npm run typecheck` type-checks the server and the app.
