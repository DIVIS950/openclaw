// Watches the phone's position while the app is open and keeps the list of map
// branches for the current area up to date.

import { searchNamesFor, normalizeName } from "./brands.js";
import { cellCenter, cellKey, cellRadiusMeters, distanceMeters } from "./geo.js";
import { fetchBranches, filterBranches } from "./osm.js";
import { state, notify, updateSettings } from "./state.js";
import { osmCache } from "./store.js";

const CACHE_TTL_MS = 14 * 24 * 3600 * 1000;
const MAX_NAMES_PER_QUERY = 12;

let watchId = null;
let fetching = false;
let nextFetchAllowed = 0;

/** Start watching the position (asks for permission the first time). */
export function startLocation() {
  if (!("geolocation" in navigator)) {
    state.locStatus = "unavailable";
    notify();
    return;
  }
  if (watchId !== null) {
    return;
  }
  if (!state.pos) {
    state.locStatus = "searching";
    notify();
  }
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      const next = {
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        accuracy: p.coords.accuracy,
        at: p.timestamp,
      };
      // GPS fires often while standing still; only redraw when it actually moved
      // (or got much more precise), so the screen doesn't jitter.
      const prev = state.pos;
      const moved =
        !prev ||
        state.locStatus !== "on" ||
        distanceMeters(prev, next) > 6 ||
        Math.abs(prev.accuracy - next.accuracy) > Math.max(10, prev.accuracy * 0.3);
      state.pos = next;
      state.locStatus = "on";
      if (!state.settings.locationWanted) {
        updateSettings({ locationWanted: true });
      }
      if (moved) {
        notify();
        refreshBranches();
      }
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        state.locStatus = "denied";
        stopLocation();
        updateSettings({ locationWanted: false });
      } else if (!state.pos) {
        state.locStatus = "unavailable";
      }
      notify();
    },
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
  );
}

export function stopLocation() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

/** Resume or pause GPS with the page's visibility to save battery. */
export function bindVisibility() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopLocation();
    } else if (state.settings.locationWanted) {
      startLocation();
    }
  });
}

/** On launch, start silently if the user turned location on before. */
export async function autoStartLocation() {
  if (!state.settings.locationWanted) {
    try {
      const status = await navigator.permissions?.query({ name: "geolocation" });
      if (status?.state !== "granted") {
        return;
      }
    } catch {
      return;
    }
  }
  startLocation();
}

/** Forget cached map results (e.g. after renaming a card). */
export function invalidateBranches() {
  nextFetchAllowed = 0;
  refreshBranches();
}

/**
 * Load branches for the area around the current position, from cache or Overpass.
 * One query covers every card whose branches are not cached yet.
 */
export async function refreshBranches() {
  const pos = state.pos;
  if (!pos) {
    return;
  }
  const cell = cellKey(pos);
  const cards = state.cards.filter((c) => c.autoBranches);
  if (!state.settings.osm || !cards.length) {
    if (Object.keys(state.branches).length) {
      state.branches = {};
      notify();
    }
    return;
  }

  // 1) Cached results for this cell.
  const now = Date.now();
  const byName = new Map();
  const missing = [];
  for (const card of cards) {
    for (const name of searchNamesFor(card)) {
      const key = normalizeName(name);
      if (byName.has(key)) {
        continue;
      }
      const hit = await osmCache.get(`${cell}|${key}`);
      if (hit && now - hit.at < CACHE_TTL_MS) {
        byName.set(key, hit.items);
      } else {
        byName.set(key, null);
        missing.push(name);
      }
    }
  }
  applyBranches(cards, byName);

  // 2) Ask the map for what is missing (throttled, and only once per cell change).
  if (!missing.length || fetching || !state.online || now < nextFetchAllowed) {
    return;
  }
  fetching = true;
  try {
    const center = cellCenter(cell);
    for (let i = 0; i < missing.length; i += MAX_NAMES_PER_QUERY) {
      const names = missing.slice(i, i + MAX_NAMES_PER_QUERY);
      const points = await fetchBranches(names, center, cellRadiusMeters());
      for (const name of names) {
        const items = filterBranches(points, [name]).map(({ id, lat, lon, name: n, address }) => ({
          id,
          lat,
          lon,
          name: n,
          address,
        }));
        const key = normalizeName(name);
        byName.set(key, items);
        await osmCache.set(`${cell}|${key}`, { at: Date.now(), items });
      }
    }
    nextFetchAllowed = Date.now() + 20_000;
    applyBranches(cards, byName);
  } catch {
    // Map service busy or offline: try again in a couple of minutes.
    nextFetchAllowed = Date.now() + 120_000;
  } finally {
    fetching = false;
  }
}

function applyBranches(cards, byName) {
  const next = {};
  for (const card of cards) {
    const seen = new Set();
    const list = [];
    for (const name of searchNamesFor(card)) {
      for (const item of byName.get(normalizeName(name)) ?? []) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          list.push(item);
        }
      }
    }
    next[card.id] = list;
  }
  state.branches = next;
  notify();
}
