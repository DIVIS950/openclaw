# Orbit — shop everything, safely

A shopping app with an AI assistant. Search once and compare every shop, get a
scam check on each store, choose fast or cheap delivery to your address, pay
inside the app, and watch your parcel travel on an animated map.

## Features

- **Search any product across every shop.** Claude searches the web, and results
  stream in with prices including delivery to your city.
- **Scam shield.** Each shop gets a 0–100 trust score. Orbit won't buy from shops
  flagged as likely scams.
- **"Should you buy it?"** An AI opinion (Buy now / Wait / Skip) with three reasons.
- **Coupon finder.** Published discount codes for the chosen shop. Orbit tries the
  code when ordering and charges less only if it works.
- **Orbit buys it for you.** Pay in the app with Apple Pay, Google Pay or card.
  The money is only reserved. The owner buys the item at the shop from the admin
  page, and only then is the customer charged. Cancelling releases the money.
- **Order tracking.** A status timeline and the carrier's tracking link, plus an
  animated map, boarding pass or delivery van once the order ships.
- **Gmail parcels** (read-only), **Google sign-in**, installable on phones (PWA),
  and light and dark themes.

## Run it

```bash
cd apps/shopping
npm install
npm run dev          # http://localhost:3000
```

Without keys, the app runs but search, AI and payments stay switched off, and
each screen says what's missing. See [DEPLOY.md](DEPLOY.md) to switch them on.

### One-file web demo

```bash
node static/build.mjs   # -> static/dist/orbit.html (no server needed)
```

This bundles the whole demo, including the map data and the demo AI, into one
HTML page that can be hosted anywhere.

### Tests

```bash
npm test          # logic: scam scoring, delivery, cards, search parsing, parcels
npm run test:e2e     # clicks through the web preview on phone + desktop (light/dark)
npm run test:orders  # full order flow against a fake Stripe: reserve, charge, ship, cancel
```

The end-to-end run replaces Claude with a scripted stand-in, so it's free and
repeatable. It checks for page errors and sideways scrolling on every screen.

## Turn on the real services

Copy `.env.example` to `.env.local` and fill in the keys you want. Each one
switches on its own feature:

| Key | Turns on |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude assistant with live web prices, and AI arrival estimates |
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google sign-in |
| `ORBIT_GMAIL=1` | Reads tracking numbers from shipping emails (Gmail read-only scope) |

**Deploying:** see [DEPLOY.md](DEPLOY.md) for step-by-step Vercel setup.

## Search

Search works for any product. With `ANTHROPIC_API_KEY`, the server uses Claude
with web search for live prices, and results stream in as they're found. In the
one-file web demo, Claude answers from what it knows, so prices are labeled as
estimates. With neither, the built-in sample catalog is used.

## Next steps

1. **Automatic ordering** for shops with an ordering API (for example Shopify
   stores), so the admin step becomes a button.
2. **Carrier tracking API** (AfterShip or 17TRACK) for real scan events on the map.
3. **Emails** to customers when the status changes (for example with Resend).
4. **Phone app** for the App Store and Google Play (Capacitor or Expo).

## Security

- Security headers on every response: strict CSP, HSTS, `nosniff`, and no framing.
- Card details go straight to Stripe; Orbit never sees them. Payments are
  reserve-only until an order is placed, and the admin can't charge more than
  the customer approved.
- Customers read their order with a secret token kept on their device. The
  admin page uses a password and a signed, httpOnly cookie.
- The Google access token is kept only in the encrypted server-side session
  cookie. It is never sent to the browser.
- API input is validated with zod.
- Assistant replies are rendered as React elements, not raw HTML, and links
  must start with `http(s)`.
