// Service worker: the whole app works offline; map tiles and shop logos are cached as
// they are first shown.
// Also: daily reminder checks (Chrome on Android, installed app) and notification taps.

const VERSION = "kapsa-v3.0.0";
const TILE_CACHE = "kapsa-tiles-v1";
const MAX_TILES = 600;
const LOGO_CACHE = "kapsa-logos-v1";
const MAX_LOGOS = 300;

// Paths are listed explicitly (no "./"): some static hosts don't serve a folder's index.html.
const APP_FILES = [
  "index.html",
  "manifest.json",
  "css/app.css",
  "css/fonts.css",
  "fonts/archivo-latin-ext.woff2",
  "fonts/archivo-latin.woff2",
  "fonts/martian-mono-latin.woff2",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/logo.svg",
  "js/ai.js",
  "js/assistant-tools.js",
  "js/barcode.js",
  "js/brands.js",
  "js/confetti.js",
  "js/demo.js",
  "js/dwell.js",
  "js/geo.js",
  "js/habits.js",
  "js/i18n.js",
  "js/icons.js",
  "js/location.js",
  "js/look.js",
  "js/main.js",
  "js/model.js",
  "js/nav.js",
  "js/osm.js",
  "js/reminders.js",
  "js/scanner.js",
  "js/state.js",
  "js/stats.js",
  "js/store.js",
  "js/strings-cs.js",
  "js/strings-en.js",
  "js/ui/app.js",
  "js/ui/assistant.js",
  "js/ui/cardform.js",
  "js/ui/cardpage.js",
  "js/ui/couponform.js",
  "js/ui/coupons.js",
  "js/ui/gift.js",
  "js/ui/kit.js",
  "js/ui/logsheet.js",
  "js/ui/map.js",
  "js/ui/pages.js",
  "js/ui/scanner.js",
  "js/ui/settings.js",
  "js/ui/stats.js",
  "js/ui/wallet.js",
  "js/util.js",
  "vendor/anthropic.js",
  "vendor/barcode-detector.js",
  "vendor/bwip.js",
  "vendor/leaflet/leaflet.css",
  "vendor/leaflet/leaflet.js",
  "vendor/preact.js",
  "vendor/zxing_reader.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(APP_FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION && k !== TILE_CACHE && k !== LOGO_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") {
    self.skipWaiting();
  }
});

async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
  }
}

/** Cache-first for things that never change at the same URL (tiles, logos). */
function cacheFirst(event, name, max) {
  event.respondWith(
    (async () => {
      const cache = await caches.open(name);
      const hit = await cache.match(event.request);
      if (hit) {
        return hit;
      }
      const res = await fetch(event.request);
      if (res.ok || res.type === "opaque") {
        await cache.put(event.request, res.clone());
        trimCache(cache, max);
      }
      return res;
    })(),
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    return;
  }
  const url = new URL(req.url);

  // Map tiles: cache-first so places you've seen work offline.
  if (url.hostname.endsWith("basemaps.cartocdn.com")) {
    cacheFirst(event, TILE_CACHE, MAX_TILES);
    return;
  }
  // Shop logos (website icons): cached so cards keep their logo offline.
  if (url.hostname === "www.google.com" && url.pathname === "/s2/favicons") {
    cacheFirst(event, LOGO_CACHE, MAX_LOGOS);
    return;
  }

  // Map searches and Claude always go to the network.
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

// ---------- Reminders while the app is closed ----------

function readAll(db, store) {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readonly").objectStore(store).getAll();
      req.addEventListener("success", () => resolve(req.result ?? []));
      req.addEventListener("error", () => resolve([]));
    } catch {
      resolve([]);
    }
  });
}

function readKey(db, store, key) {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readonly").objectStore(store).get(key);
      req.addEventListener("success", () => resolve(req.result));
      req.addEventListener("error", () => resolve(undefined));
    } catch {
      resolve(undefined);
    }
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("kapsa");
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });
}

/** Coupons and cards that expire soon (same rule as the app, kept short on purpose). */
async function checkExpiring() {
  const db = await openDb();
  const settings = (await readKey(db, "kv", "settings")) ?? {};
  if (!settings.notifications) {
    return;
  }
  const days = settings.remindDays ?? 3;
  const coupons = db.objectStoreNames.contains("coupons") ? await readAll(db, "coupons") : [];
  const cards = await readAll(db, "cards");
  const cs = (settings.lang === "cs") || (settings.lang !== "en" && /^(cs|sk)/i.test(self.navigator.language || ""));
  const now = Date.now();
  const left = (iso) => Math.ceil((new Date(`${iso}T23:59:59`).getTime() - now) / 86400000) - 1;
  const items = [];
  for (const c of coupons) {
    if (!c.used && c.expiry) {
      const d = left(c.expiry);
      if (d >= 0 && d <= days) {
        items.push({ tag: `ce:${c.id}:${c.expiry}`, title: cs ? "Kupón brzy končí" : "Coupon ending soon", body: [c.discount, c.title].filter(Boolean).join(" · "), url: `#coupon-${c.id}` });
      }
    }
  }
  for (const c of cards) {
    if (c.expiry) {
      const d = left(c.expiry);
      if (d >= 0 && d <= Math.max(days, 7)) {
        items.push({ tag: `ke:${c.id}:${c.expiry}`, title: cs ? "Karta brzy končí" : "Card expiring soon", body: c.name, url: `#card-${c.id}` });
      }
    }
  }
  const shown = new Set(((await readKey(db, "kv", "notified")) ?? []));
  for (const it of items) {
    if (!shown.has(it.tag)) {
      await self.registration.showNotification(it.title, { body: it.body, tag: it.tag, icon: "icons/icon-192.png", data: { url: it.url } });
    }
  }
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "kapsa-reminders") {
    event.waitUntil(checkExpiring().catch(() => {}));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(`index.html${event.notification.data?.url ?? ""}`, self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if ("focus" in w) {
          await w.focus();
          if ("navigate" in w) {
            return w.navigate(target);
          }
          return undefined;
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
