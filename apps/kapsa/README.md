# Kapsa

Kapsa ("pocket" in Czech) is a phone web app for loyalty and membership cards that knows where you are.
Scan a card once, save where the shop is, and the next time you walk in the card is already open on the
screen with its barcode at full size.

## What it does

- **Scan any card** with the camera (EAN-13, EAN-8, UPC, Code 128, Code 39/93, ITF, Codabar, QR, PDF417,
  Aztec, Data Matrix), read the code from a photo, or type the number.
- **"You're here"**: while the app is open it watches your location. When you are within the chosen radius
  of a saved place, that card rises to the top. It can also open the card by itself.
- **Places, several ways**: save the spot you are standing on, pick a shop that is right around you (from
  OpenStreetMap), search an address, or drop a pin on the map.
- **Branches found automatically**: for chains (Bageterie Boulevard, Albert, dm, Billa and so on) Kapsa
  looks up every branch with the same name around you in OpenStreetMap, so the card also works in shops you
  never saved.
- **Map** of saved places and found branches.
- Big, bright, always-white code panel; the screen stays awake while a card is open.
- Czech and English (follows the phone, can be switched), light and dark themes.
- Works offline after the first visit, can be installed to the home screen.
- Backup to a file and restore; share a single card as a link.
- Cards stay on the phone (IndexedDB). Only map lookups send a rough location and a shop name to
  OpenStreetMap, and that can be switched off in Settings.

## Run it

It is a static site with no build step. Any HTTPS host works (the camera and location need HTTPS, or
`localhost` while developing).

```sh
cd apps/kapsa
python3 -m http.server 8080
# open http://localhost:8080
```

To publish, copy the `apps/kapsa` folder to any static host (GitHub Pages, Netlify, Cloudflare Pages,
Vercel). On iPhone, open the address in Safari and use Share, then Add to Home Screen; on Android, use
Install app in the Chrome menu.

## Tests

```sh
node --test apps/kapsa/tests/*.test.mjs
```

The tests cover distances and ranking, barcode check digits and format guessing, shop-name matching,
OpenStreetMap query building and parsing, both languages, and that the service worker precaches every file.

## Updating

`sw.js` caches the app for offline use. When you change any file, bump `VERSION` in `sw.js`; open apps then
offer a "Reload" button for the new version. If you add a file, add it to `APP_FILES` (a test checks this).

## Layout

| Path | What it is |
| --- | --- |
| `index.html`, `manifest.webmanifest`, `sw.js` | Page shell, install manifest, offline cache |
| `css/app.css` | All styles and design tokens |
| `js/app.js` | Boot, routing between pages and sheets, auto-open |
| `js/views/` | Wallet, card, add/edit, map, settings, address search screens |
| `js/geo.js`, `js/location.js` | Distances, "you're here" ranking, location watching and branch lookups |
| `js/barcode.js`, `js/scanner.js` | Barcode formats and drawing, camera and photo reading |
| `js/osm.js`, `js/brands.js` | OpenStreetMap queries, known chains and name matching |
| `vendor/` | bwip-js (drawing codes), barcode-detector + zxing-wasm (reading codes), Leaflet (map) |

Third-party code: bwip-js (MIT), barcode-detector and zxing-wasm (MIT, ZXing under Apache-2.0),
Leaflet (BSD-2-Clause), Lucide icons (ISC), Archivo and Martian Mono fonts (SIL OFL 1.1).
Map data © OpenStreetMap contributors, map tiles © CARTO.

## Česky

Kapsa je aplikace na věrnostní karty do mobilu. Kartu jednou naskenuješ, uložíš si, kde je obchod, a až
tam příště přijdeš, karta je nahoře a připravená k načtení. U řetězců (Bageterie Boulevard, Albert, dm…)
najde sama i ostatní pobočky v okolí. Karty zůstávají jen v telefonu. Na iPhonu otevři adresu v Safari a
dej Sdílet → Přidat na plochu.
