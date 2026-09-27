# Orbit — shop everything, safely

A shopping app with an AI assistant. Search once and compare every shop, get a
scam check on each store, choose fast or cheap delivery to your address, pay
inside the app, and watch your parcel travel on an animated map.

## Features

- **One search, every shop.** Prices are compared with delivery to your city included.
- **Scam shield.** Each store gets a 0–100 trust score based on domain age,
  HTTPS, review volume, return policy and prices that are far below market.
  Orbit won't let you pay a shop it flags as a likely scam.
- **Delivery by speed.** Economy, standard, express, and same-day for local
  shops. The faster options cost more.
- **In-app checkout.** Your address and saved card are filled in for you, with
  no redirect. Only the card brand and last 4 digits are ever stored.
- **Orbit AI (Claude).** A chat assistant that uses live web search to check
  prices and unfamiliar shops.
- **Parcel tracking.**
  - Import parcels from Gmail (read-only).
  - Air parcels fly across a 3D globe and come with a boarding pass.
  - Road parcels drive along a map in an animated delivery van.
  - Claude estimates the arrival time and says how confident it is.
- **Google sign-in**, installable on your phone (PWA), and light and dark themes.

## Run it

```bash
cd apps/shopping
npm install
npm run dev          # http://localhost:3000
```

With no keys set, Orbit runs in **demo mode** with sample shops, prices and
parcels, so every screen works right away.

### One-file web demo

```bash
node static/build.mjs   # -> static/dist/orbit.html (no server needed)
```

This bundles the whole demo, including the map data and the demo AI, into one
HTML page that can be hosted anywhere.

## Turn on the real services

Copy `.env.example` to `.env.local` and fill in the keys you want. Each one
switches on its own feature:

| Key | Turns on |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude assistant with live web prices, and AI arrival estimates |
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google sign-in |
| `ORBIT_GMAIL=1` | Reads tracking numbers from shipping emails (Gmail read-only scope) |

## Roadmap for going fully live

1. **Payments:** replace the simulated payment in `CheckoutView.tsx` with a
   Stripe PaymentIntent and the Payment Element.
2. **Live catalog:** load shops and prices from a product search API such as
   Google Shopping or SerpAPI, in place of the data in `src/lib/data.ts`.
3. **Carrier tracking:** look up the tracking numbers found in Gmail with a
   tracking API such as AfterShip or 17TRACK to get real scan events.
4. **Mobile app:** wrap the app with Capacitor, or port the screens to Expo,
   for the App Store and Google Play.

## Security

- Security headers on every response: strict CSP, HSTS, `nosniff`, and no framing.
- The Google access token is kept only in the encrypted server-side session
  cookie. It is never sent to the browser.
- API input is validated with zod.
- Assistant replies are rendered as React elements, not raw HTML, and links
  must start with `http(s)`.
