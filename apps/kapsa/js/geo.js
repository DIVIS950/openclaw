// Pure location helpers: distances, grid cells and "which card belongs here" ranking.
// No DOM or network access here so it can be unit tested with `node --test`.

const EARTH_RADIUS_M = 6_371_000;

/** @typedef {{ lat: number, lon: number }} LatLon */

/**
 * Great-circle distance in metres (haversine).
 * @param {LatLon} a
 * @param {LatLon} b
 */
export function distanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Grid cell size in degrees used for caching map lookups (~2 km in central Europe). */
export const CELL_DEG = 0.02;

/**
 * Stable key of the grid cell that contains a point.
 * @param {LatLon} p
 */
export function cellKey(p) {
  const y = Math.floor(p.lat / CELL_DEG);
  const x = Math.floor(p.lon / CELL_DEG);
  return `${y}:${x}`;
}

/**
 * Centre of a grid cell (inverse of cellKey).
 * @param {string} key
 * @returns {LatLon}
 */
export function cellCenter(key) {
  const [y, x] = key.split(":").map(Number);
  return { lat: (y + 0.5) * CELL_DEG, lon: (x + 0.5) * CELL_DEG };
}

/**
 * Radius (m) that covers a whole cell from its centre, plus a margin so that shops
 * just across the cell edge are still found.
 */
export function cellRadiusMeters() {
  return 2600;
}

/**
 * GPS fixes are noisy. Treat the reported accuracy as partly in our favour so a
 * card still counts as "here" indoors, but cap it so a 2 km fix never matches.
 * @param {number} distance metres to the place
 * @param {number} accuracy metres reported by the browser
 */
export function effectiveDistance(distance, accuracy) {
  const slack = Math.min(Math.max(accuracy || 0, 0), 150) / 2;
  return Math.max(0, distance - slack);
}

/**
 * Nearest place of one card, looking at saved places and auto-found branches.
 * @param {{ places?: Array<LatLon & { label?: string }> }} card
 * @param {LatLon} pos
 * @param {Array<LatLon & { label?: string }>} [branches]
 * @returns {{ distance: number, place: LatLon & { label?: string }, source: "saved" | "branch" } | null}
 */
export function nearestPlace(card, pos, branches = []) {
  let best = null;
  for (const place of card.places ?? []) {
    const d = distanceMeters(pos, place);
    if (!best || d < best.distance) {
      best = { distance: d, place, source: "saved" };
    }
  }
  for (const place of branches) {
    const d = distanceMeters(pos, place);
    // Prefer a saved place on ties: it is the one the user confirmed.
    if (!best || d < best.distance - 1) {
      best = { distance: d, place, source: "branch" };
    }
  }
  return best;
}

/**
 * Sort cards for the wallet: cards you are at first, then by distance, then by use.
 * @template {{ id: string, name: string, uses?: number, lastUsedAt?: number, places?: Array<LatLon> }} C
 * @param {C[]} cards
 * @param {{ lat: number, lon: number, accuracy?: number } | null} pos
 * @param {Record<string, Array<LatLon & { label?: string }>>} branchesByCard
 * @param {number} radius metres that count as "I am at this shop"
 * @returns {Array<{ card: C, distance: number | null, here: boolean, place: (LatLon & { label?: string }) | null, source: string | null }>}
 */
export function rankCards(cards, pos, branchesByCard, radius) {
  const rows = cards.map((card) => {
    if (!pos) {
      return { card, distance: null, here: false, place: null, source: null };
    }
    const near = nearestPlace(card, pos, branchesByCard[card.id] ?? []);
    if (!near) {
      return { card, distance: null, here: false, place: null, source: null };
    }
    const here = effectiveDistance(near.distance, pos.accuracy ?? 0) <= radius;
    return { card, distance: near.distance, here, place: near.place, source: near.source };
  });
  const byUse = (a, b) =>
    (b.card.lastUsedAt ?? 0) - (a.card.lastUsedAt ?? 0) ||
    (b.card.uses ?? 0) - (a.card.uses ?? 0) ||
    a.card.name.localeCompare(b.card.name);
  rows.sort((a, b) => {
    if (a.here !== b.here) {
      return a.here ? -1 : 1;
    }
    if (a.distance !== null && b.distance !== null) {
      return a.distance - b.distance;
    }
    if (a.distance !== null) {
      return -1;
    }
    if (b.distance !== null) {
      return 1;
    }
    return byUse(a, b);
  });
  return rows;
}

/**
 * Format a distance for people: "12 m", "350 m", "1,2 km" / "1.2 km".
 * @param {number} meters
 * @param {string} locale
 */
export function formatDistance(meters, locale) {
  if (meters < 1000) {
    const rounded = meters < 100 ? Math.max(1, Math.round(meters)) : Math.round(meters / 10) * 10;
    return `${rounded} m`;
  }
  const km = meters / 1000;
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: km < 10 ? 1 : 0 });
  return `${nf.format(km)} km`;
}
