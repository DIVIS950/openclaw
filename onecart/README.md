# OneCart

Shop from many online stores in one app: one cart, one checkout, and every package tracked in one place.
Runs on **iPhone, Android and web** from one codebase (Expo + React Native).

## What works today

| Feature | Status |
| --- | --- |
| Search products across all connected stores | ✅ |
| One cart with items from several stores | ✅ |
| One checkout that places a separate order with each store | ✅ for demo stores; real Shopify stores open their own secure checkout inside the app |
| Orders get tracking added automatically | ✅ |
| Find packages in Gmail (read-only) | ✅ once you add a Google client ID |
| Paste any shipping email or tracking number | ✅ detects UPS, USPS, FedEx and DHL |
| Live carrier scans | 🟡 demo timeline for now; plug in a tracking API (see below) |

Everything you do is saved on the device.

## Run it

```bash
npm install
npm run web        # in the browser
npm run ios        # iPhone (needs a Mac, or use Expo Go / EAS)
npm run android    # Android
```

Checks: `npm test` (unit tests), `npm run typecheck`.

## Connect real stores

### Shopify stores
Each Shopify store can give you a **Storefront API token** (Shopify admin → Apps → Develop apps, or the Headless channel).
Put them in `.env.local` (copy `.env.example`; it is git-ignored):

```
EXPO_PUBLIC_SHOPIFY_STORES=my-shop.myshopify.com|<token>,other-shop.myshopify.com|<token>
```

Their products show up next to the demo stores. At checkout the app creates a Shopify cart and opens that
store's checkout inside the app, so payment, tax and shipping are handled by the store.

### Other platforms (Amazon, WooCommerce, …)
Add a connector in `src/lib/stores/`: implement `search()` and `checkout()` from `connector.ts`,
then register it in `src/lib/stores/index.ts`. Most big marketplaces only allow this through their
partner or affiliate programmes, so you need an account with them first.

## Gmail import
1. In Google Cloud Console, enable the **Gmail API**.
2. Create OAuth client IDs (Web, iOS, Android) and put them in `.env.local` (see `.env.example`).
3. For iOS and Android, add the reversed client ID (`com.googleusercontent.apps.<id>`) as a URL scheme in `app.json`.

The app only asks for `gmail.readonly`. To publish to the public, Google must verify the app,
because Gmail is a restricted scope. Until then, it works for test users you add in the console.

## Live tracking
`src/lib/tracking/status.ts` simulates the carrier journey. To show real scans, sign up for a tracking API
(AfterShip, 17TRACK, EasyPost, Ship24…) and replace `simulateTracking` with a call to it. Keep the
API key on a small server, not in the app.

## Project layout

```
src/app/            screens (Expo Router)
  (tabs)/           Shop, Cart, Orders, Packages
  checkout.tsx      one checkout for every store
  import-email.tsx  Gmail + paste-an-email import
  package/[id].tsx  package timeline
src/lib/stores/     store connectors (demo, Shopify)
src/lib/tracking/   carrier detection, email parser, tracking status
src/lib/gmail.ts    Gmail API reader
src/state/          app state, saved on the device
```

## Publishing the phone apps
Use EAS: `npx eas-cli@latest build -p ios` and `-p android`, then `eas submit`.
You need an Apple Developer account ($99 a year) and a Google Play developer account ($25 once).
