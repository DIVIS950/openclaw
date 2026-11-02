// Service worker: the whole app works offline; map tiles are cached as you browse.

const VERSION = "kapsa-v1.1.0";
const TILE_CACHE = "kapsa-tiles-v1";
const MAX_TILES = 600;

// Paths are listed explicitly (no "./"): some static hosts don't serve a folder's index.html.
const APP_FILES = [
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/ai.js",
  "js/app.js",
  "js/barcode.js",
  "js/brands.js",
  "js/cardview.js",
  "js/dom.js",
  "js/geo.js",
  "js/gesture.js",
  "js/habits.js",
  "js/i18n.js",
  "js/icons.js",
  "js/location.js",
  "js/model.js",
  "js/nav.js",
  "js/osm.js",
  "js/scanner.js",
  "js/state.js",
  "js/store.js",
  "js/views/addflow.js",
  "js/views/aisettings.js",
  "js/views/assistant.js",
  "js/views/bigcode.js",
  "js/views/cardsheet.js",
  "js/views/extrafields.js",
  "js/views/home.js",
  "js/views/mapview.js",
  "js/views/scanstep.js",
  "js/views/settings.js",
  "js/views/sheets.js",
  "vendor/anthropic.mjs",
  "vendor/bwip.mjs",
  "vendor/barcode-detector.js",
  "vendor/zxing_reader.wasm",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "fonts/archivo-latin.woff2",
  "fonts/archivo-latin-ext.woff2",
  "fonts/martian-mono-latin.woff2",
  "icons/logo.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(APP_FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION && k !== TILE_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") {
    self.skipWaiting();
  }
});

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) {
    await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    return;
  }
  const url = new URL(req.url);

  // Map tiles: cache-first so places you've seen work offline.
  if (url.hostname.endsWith("basemaps.cartocdn.com")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(TILE_CACHE);
        const hit = await cache.match(req);
        if (hit) {
          return hit;
        }
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") {
          await cache.put(req, res.clone());
          trimTiles(cache);
        }
        return res;
      })(),
    );
    return;
  }

  // Map searches always go to the network.
  if (url.origin !== self.location.origin) {
    return;
  }

  // App files: cache-first. Any page navigation inside the app gets index.html.
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      if (req.mode === "navigate" && !/\.[a-z0-9]+$/i.test(url.pathname.split("/").pop() ?? "")) {
        const shell = await cache.match("index.html");
        if (shell) {
          return shell;
        }
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) {
        return hit;
      }
      try {
        return await fetch(req);
      } catch (err) {
        if (req.mode === "navigate") {
          const shell = await cache.match("index.html");
          if (shell) {
            return shell;
          }
        }
        throw err;
      }
    })(),
  );
});
