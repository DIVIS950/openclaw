# SnapSell

Snap a photo of anything you want to sell. AI identifies it, checks Google Lens and real sold prices, polishes your
photos, writes the listing, and posts it to **eBay**, **Facebook Marketplace** and **Vinted**.

- **Web app for your phone.** Install it to your home screen. There's a desktop layout too.
- **Runs on your own computer.** It's free, and your data stays with you. Tailscale Funnel gives it a secure `https://`
  address that works from anywhere.
- **Private.** Sign in with Google, and only your account gets in.

The UI follows the "SnapSell App Design" canvas.

## What it does

1. **Camera.** A live viewfinder takes up to 12 photos, with tips for each shot. You can add a note for the AI
   ("battery 89%, box included").
2. **Identify.** Claude vision works out the exact item and its honest condition. **Google Lens** runs on the cover
   photo: Google Cloud Vision web detection, plus SerpApi Google Lens with shop prices.
3. **Price.** Claude searches live for sold and active listings in your country. You get a market range, a quick-sale
   price, a suggested price and a top price, with the listings behind them. A live chart fills in while prices are
   found.
4. **Photo studio.** Auto-crops to the item and fixes light, color and sharpness. There's a before/after slider and
   three presets: *Auto*, *Vivid*, and *White*, an AI background cut-out that runs on your device.
5. **Write.** A separate title and description for eBay, Facebook and Vinted, in your language. Everything stays
   editable.
6. **Sell everywhere.**
   - **eBay** uses the official API with **Log in with eBay**.
   - **Facebook Marketplace** and **Vinted** are filled in by the **SnapSell Chrome extension**, in your own
     logged-in Chrome.
   - *Copy & open* works for any site as a fallback.

## 1. Quick start (on your computer)

You need [Node.js 22+](https://nodejs.org).

```bash
cd apps/snapsell
npm install
cp .env.example .env      # put your ANTHROPIC_API_KEY in .env
npm run dev
```

Open http://localhost:5173. Without an API key SnapSell runs in **demo mode** with sample data. Until Google login
is set up it runs in **local mode** with no sign-in, so keep it off the internet until step 3 is done.

## 2. Put it online for free (Tailscale Funnel)

Your computer hosts SnapSell. Tailscale gives it a permanent `https://…ts.net` address, so your phone can use it
anywhere, not just on home Wi-Fi.

1. Install [Tailscale](https://tailscale.com/download) on the computer and sign in. It's free for personal use.
2. In a terminal, run `tailscale funnel --bg 8787`. The first time, it shows a link to turn Funnel on; open it and
   approve. Then it prints your address, for example `https://my-pc.tail1234.ts.net`.
3. Put that address in `.env` as `PUBLIC_URL=https://my-pc.tail1234.ts.net`.
4. **Set up Google login (step 3) before you share the address.**
5. Start SnapSell with `npm run online`. This builds the app and serves everything on port 8787.
6. On your phone, open the address. In Safari choose *Share → Add to Home Screen*; in Chrome choose *Install app*.

Keep the computer on and awake. Chrome must be open on it for Facebook and Vinted posting anyway.

## 3. Sign in with Google

1. Go to https://console.cloud.google.com and create a project (for example "SnapSell").
2. Open *APIs & Services → OAuth consent screen*. Choose **External**, fill in the app name and your email, and add
   yourself under *Test users*.
3. Open *Credentials → Create credentials → OAuth client ID → Web application*. Under **Authorized redirect URIs** add:
   - `https://my-pc.tail1234.ts.net/auth/google/callback` (your `PUBLIC_URL` + `/auth/google/callback`)
   - `http://localhost:5173/auth/google/callback` (for `npm run dev`)
4. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart SnapSell.

The first Google account that signs in becomes the owner. Anything you created in local mode moves to that account.
To allow more people, list their emails in `ALLOWED_EMAILS=you@gmail.com,partner@gmail.com`.

## 4. Google Lens price search (optional, both work together)

- **Google Cloud Vision** (1,000 free photos a month): in the same Google Cloud project, enable **Cloud Vision
  API**. Then use *Credentials → Create credentials → API key* (restrict it to Cloud Vision API) and put it in `.env`
  as `GOOGLE_VISION_API_KEY`. Google asks for a billing account to be linked, but the free quota covers personal use.
- **SerpApi Google Lens** (100 free searches a month): sign up at https://serpapi.com and put the key in `.env` as
  `SERPAPI_KEY`. SerpApi downloads your photo from SnapSell through a private link that expires after 10 minutes, so
  it only works once `PUBLIC_URL` is set (step 2).

## 5. Connect eBay ("Log in with eBay")

1. Create a developer account at https://developer.ebay.com and create a **Production** keyset. The App ID is your
   client ID and the Cert ID is your client secret.
2. Open *User Tokens → Get a Token from eBay via Your Application → Add eBay Redirect URL*. Set **Your auth accepted
   URL** to `https://my-pc.tail1234.ts.net/auth/ebay/callback`, turn on OAuth, and save. Copy the **RuName** it
   shows.
3. Put `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` and `EBAY_RUNAME` in `.env`. If you don't sell on eBay US, also set
   `EBAY_MARKETPLACE_ID` (for example `EBAY_DE`) and `EBAY_CONTENT_LANGUAGE` (for example `de-DE`). Restart
   SnapSell.
4. In SnapSell, go to **Connections → eBay → Log in with eBay** and approve.
5. SnapSell picks up your shipping, payment and return policies automatically. If you don't have them yet, create
   them once in eBay Seller Hub and tap *Check again*. It also asks once for the postal code you ship from.

## 6. Facebook Marketplace and Vinted (SnapSell for Chrome)

These sites have no public API, so the **SnapSell Chrome extension** posts for you. It fills in the site's own form
in your normal Chrome, with your own login.

1. In Chrome on your computer, open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `apps/snapsell/extension` folder.
3. In SnapSell, open **Connections → SnapSell for Chrome → Create pairing code**. Paste the address and the code into
   the extension's popup.
4. Log in to Facebook and Vinted in that Chrome, the normal way.

From then on, choosing Facebook or Vinted on your phone queues the post. Chrome picks it up within about 30 seconds,
opens the site in a new tab, uploads the photos, and fills in title, price, category, condition and description.

By default SnapSell stops before the final click: it brings the tab to the front and you press **Publish**.
Turning off *Let me check before it goes live* makes it press Publish too. If a field can't be found, SnapSell tells
you what to finish yourself.

> ⚠️ Automated posting is against Facebook's and Vinted's terms and can trigger checks or restrictions on your
> account. The extension only acts when you ask, types at human speed and uses your real browser, but the risk is
> yours. Keeping the final check on is the safer choice. Site layouts change, so selectors may need updating over
> time.

## How the AI works

`server/ai/analyze.ts` (with `server/ai/lens.ts`) works in three steps:

1. **Google Lens.** Cloud Vision and SerpApi run on the cover photo if they're configured. Their matches and prices
   are given to the AI as evidence.
2. **Research.** Claude gets the photos plus the `web_search` tool, identifies the item and looks up sold and asking
   prices. The analyzing screen shows this live.
3. **Compose.** Claude returns structured JSON (`shared/types.ts → AnalysisSchema`): price range, comparables, text
   for each marketplace, item specifics, and a bounding box per photo for the auto-crop.

The model is `claude-opus-5` (set `SNAPSELL_MODEL` to change it), with refusal fallbacks on. A listing typically
costs roughly $0.10–0.40 in API usage.

## Project layout

```
server/            Hono API server
  auth.ts          Sign in with Google, sessions, extension tokens
  ai/              Claude analysis, Google Lens, demo data
  publish/         eBay (official API + OAuth), extension job queue for Facebook/Vinted
  store.ts         JSON + file storage under data/
shared/types.ts    Types shared by server, app and extension jobs
src/               React app (Vite + Tailwind + Motion)
  lib/image.ts     Photo studio: crop, tone, sharpen, background removal
extension/         SnapSell for Chrome (Manifest V3, no build step)
```

All data (listings, photos, accounts, tokens) stays on your computer in `data/`. Back up that folder.

## Notes

- The *White* preset uses `@imgly/background-removal`, which downloads a small model the first time and runs on the
  device. That library is AGPL-licensed, which is fine for personal use; replace it before distributing SnapSell
  commercially.
- `npm run typecheck` type-checks the server and the app.
