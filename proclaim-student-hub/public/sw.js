// Student Hub service worker (website only, scope ./).
// - Opens offline: the app shell (index.html, tutor.html, icons, manifest) and
//   every hashed file in assets/ (scripts, styles, fonts) are kept in a cache.
// - Pages: the cached copy shows at once and a fresh one is fetched behind it
//   (stale-while-revalidate), so the next open has the new build. "Update now"
//   (?v=…) always asks the network first.
// - assets/: names change with every build, so a cached file never goes stale
//   (cache-first). Files no longer used by the current or newest page are dropped.
// - private.dat: network first, the cached copy when offline.
// - version.json and everything else: straight to the network.
// - Tapping a reminder opens the hub (iPhone needs a service worker for those).

const VERSION = "v2";
const SHELL = `psh-shell-${VERSION}`;
const ASSETS = `psh-assets-${VERSION}`;
const DATA = `psh-data-${VERSION}`;
const KEEP = new Set([SHELL, ASSETS, DATA]);

const scope = () => self.registration.scope;
const at = (path) => new URL(path, scope()).href;
const PAGES = ["index.html", "tutor.html"];
const STATIC = ["manifest.webmanifest", "icon.svg", "icon-180.png", "icon-512.png"];
// Built file names look like main-DjxekqLu.js or figtree-latin-CEHu_veL.woff2.
const HASHED = /[\w.-]+-[\w-]{6,}\.(?:js|css|woff2?|png|svg|jpe?g|webp)/g;

/** The hashed files a page needs: its scripts and styles, their chunks and fonts. */
async function assetsOf(html) {
  const found = new Set();
  const queue = [];
  const add = (name) => {
    const url = at(`assets/${name}`);
    if (!found.has(url)) {
      found.add(url);
      queue.push(url);
    }
  };
  for (const name of html.match(HASHED) ?? []) {
    add(name);
  }
  // Scripts name their lazy chunks and styles name their fonts: follow them.
  while (queue.length > 0) {
    const url = queue.shift();
    if (!/\.(?:js|css)$/.test(url)) {
      continue;
    }
    const res = await fileFor(url);
    if (!res) {
      continue;
    }
    for (const name of (await res.text()).match(HASHED) ?? []) {
      add(name);
    }
  }
  return found;
}

/** A hashed file from the cache, or from the network (and then kept). */
async function fileFor(url) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(url);
  if (hit) {
    return hit.clone();
  }
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    await cache.put(url, res.clone());
    return res;
  } catch {
    return null;
  }
}

/** Drops hashed files that none of these pages use any more. */
async function prune(htmls) {
  const needed = new Set();
  for (const html of htmls) {
    for (const url of await assetsOf(html)) {
      needed.add(url);
    }
  }
  const cache = await caches.open(ASSETS);
  for (const req of await cache.keys()) {
    if (!needed.has(req.url)) {
      await cache.delete(req);
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      for (const path of [...PAGES, ...STATIC]) {
        try {
          const res = await fetch(at(path), { cache: "reload" });
          if (res.ok) {
            await shell.put(at(path), res.clone());
            if (path.endsWith(".html")) {
              await assetsOf(await res.text());
            }
          }
        } catch {
          // Offline while installing: picked up on the next visit instead.
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("psh-") && !KEEP.has(name)) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

/** Which cached page a navigation means, or null for anything else. */
function pageKey(url) {
  const rel = url.href.slice(scope().length).split(/[?#]/)[0];
  if (rel === "" || rel === "index.html") {
    return at("index.html");
  }
  return rel === "tutor.html" ? at("tutor.html") : null;
}

/**
 * A page: the cached copy at once and a fresh one fetched behind it. `done`
 * settles when the fresh copy (and its files) are stored.
 */
function navigate(request, key) {
  const shellP = caches.open(SHELL);
  const cachedP = shellP.then((shell) => shell.match(key));
  const fresh = shellP.then(async (shell) => {
    try {
      const res = await fetch(request);
      if (res.ok && res.type === "basic") {
        const html = await res.clone().text();
        // Its own copy: the one in cachedP may already be on its way to the page.
        const before = (await (await shell.match(key))?.text()) ?? "";
        await shell.put(key, res.clone());
        if (html !== before) {
          // Fetch the new build's files now; keep the old ones the open page uses.
          await prune(before ? [before, html] : [html]);
        }
      }
      return res;
    } catch {
      return null;
    }
  });
  const wantsFresh = new URL(request.url).searchParams.has("v");
  const response = (async () => {
    const cached = await cachedP;
    if (cached && !wantsFresh) {
      return cached;
    }
    const shell = await shellP;
    return (await fresh) ?? cached ?? (await shell.match(at("index.html"))) ?? Response.error();
  })();
  return { response, done: fresh.then(() => undefined) };
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) {
      await cache.put(request.url.split("?")[0], res.clone());
    }
    return res;
  } catch {
    return (await cache.match(request.url.split("?")[0])) ?? Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) {
    return hit;
  }
  const res = await fetch(request);
  if (res.ok && res.type === "basic") {
    await cache.put(request, res.clone());
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(scope())) {
    return;
  }
  const rel = url.pathname.slice(new URL(scope()).pathname.length);
  if (request.mode === "navigate") {
    const key = pageKey(url);
    if (key) {
      const { response, done } = navigate(request, key);
      event.respondWith(response);
      event.waitUntil(done);
    }
    return;
  }
  if (rel.startsWith("assets/")) {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }
  if (rel === "private.dat") {
    event.respondWith(networkFirst(request, DATA));
    return;
  }
  if (STATIC.includes(rel)) {
    event.respondWith(cacheFirst(request, SHELL));
  }
  // version.json and anything else: the network, untouched.
});

// Tapping a reminder opens the hub (or brings it to the front).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
