// OpenStreetMap lookups: shop branches (Overpass) and address search (Nominatim).
// Query builders and parsers are pure; `fetch*` functions do the network calls.

import { shopMatches } from "./brands.js";
import { distanceMeters } from "./geo.js";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const NOMINATIM = "https://nominatim.openstreetmap.org";

/**
 * Escape text for a POSIX regex inside an Overpass double-quoted string.
 * @param {string} value
 */
export function overpassRegexEscape(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&").replace(/"/g, '\\"');
}

/**
 * Overpass query for shops whose name or brand starts with one of `names`.
 * @param {string[]} names
 * @param {{ lat: number, lon: number }} center
 * @param {number} radius metres
 */
export function branchQuery(names, center, radius) {
  const alternatives = names.map(overpassRegexEscape).join("|");
  const around = `around:${Math.round(radius)},${center.lat.toFixed(5)},${center.lon.toFixed(5)}`;
  return `[out:json][timeout:20];nwr(${around})[~"^(name|brand)$"~"^(${alternatives})",i];out center tags 300;`;
}

/**
 * Overpass query for named shops and places right around a point ("where am I?").
 * @param {{ lat: number, lon: number }} center
 * @param {number} radius metres
 */
export function hereQuery(center, radius) {
  const around = `around:${Math.round(radius)},${center.lat.toFixed(5)},${center.lon.toFixed(5)}`;
  return `[out:json][timeout:15];(nwr(${around})[name][shop];nwr(${around})[name][amenity~"^(cafe|restaurant|fast_food|pharmacy|fuel|bar|pub|ice_cream|cinema|fitness_centre)$"];nwr(${around})[name][leisure~"^(fitness_centre|sports_centre)$"];);out center tags 40;`;
}

/**
 * Turn Overpass JSON into simple points.
 * @param {{ elements?: Array<Record<string, any>> }} json
 * @returns {Array<{ id: string, lat: number, lon: number, name: string, brand: string, kind: string, address: string }>}
 */
export function parseElements(json) {
  const out = [];
  for (const el of json?.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const tags = el.tags ?? {};
    if (typeof lat !== "number" || typeof lon !== "number" || !(tags.name || tags.brand)) {
      continue;
    }
    const street = [tags["addr:street"] ?? tags["addr:place"], tags["addr:housenumber"]].filter(Boolean).join(" ");
    out.push({
      id: `${el.type}/${el.id}`,
      lat,
      lon,
      name: tags.name ?? tags.brand,
      brand: tags.brand ?? "",
      kind: tags.shop ?? tags.amenity ?? tags.leisure ?? "",
      address: [street, tags["addr:city"]].filter(Boolean).join(", "),
    });
  }
  return out;
}

/**
 * Keep only map points that belong to a card's shop names.
 * @param {ReturnType<typeof parseElements>} points
 * @param {string[]} names
 */
export function filterBranches(points, names) {
  return points.filter((p) => names.some((n) => shopMatches(n, p.name) || (p.brand && shopMatches(n, p.brand))));
}

/**
 * Nearby named places sorted by distance, one entry per name.
 * @param {ReturnType<typeof parseElements>} points
 * @param {{ lat: number, lon: number }} pos
 */
export function nearbyNames(points, pos) {
  const seen = new Map();
  for (const p of points) {
    const d = distanceMeters(pos, p);
    const key = p.name.toLowerCase();
    if (!seen.has(key) || seen.get(key).distance > d) {
      seen.set(key, { ...p, distance: d });
    }
  }
  const list = [...seen.values()];
  list.sort((a, b) => a.distance - b.distance);
  return list;
}

async function overpass(query, signal) {
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal,
      });
      if (!res.ok) {
        throw new Error(`Overpass ${res.status}`);
      }
      return parseElements(await res.json());
    } catch (err) {
      if (signal?.aborted) {
        throw err;
      }
      lastError = err;
    }
  }
  throw lastError ?? new Error("Overpass unavailable");
}

/**
 * Branches of the given shop names around a point.
 * @param {string[]} names
 * @param {{ lat: number, lon: number }} center
 * @param {number} radius
 * @param {AbortSignal} [signal]
 */
export async function fetchBranches(names, center, radius, signal) {
  if (!names.length) {
    return [];
  }
  return overpass(branchQuery(names, center, radius), signal);
}

/**
 * Named shops within a short distance (used to suggest the card name).
 * @param {{ lat: number, lon: number }} pos
 * @param {AbortSignal} [signal]
 */
export async function fetchHere(pos, signal) {
  return nearbyNames(await overpass(hereQuery(pos, 90), signal), pos);
}

/**
 * Address or place search.
 * @param {string} text
 * @param {{ lat: number, lon: number } | null} near bias results around this point
 * @param {string} lang
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{ lat: number, lon: number, label: string, detail: string }>>}
 */
export async function searchAddress(text, near, lang, signal) {
  const params = new URLSearchParams({
    q: text,
    format: "jsonv2",
    limit: "6",
    addressdetails: "0",
    "accept-language": `${lang},en`,
  });
  if (near) {
    const d = 0.25;
    params.set("viewbox", [near.lon - d, near.lat + d, near.lon + d, near.lat - d].map((v) => v.toFixed(4)).join(","));
  }
  const res = await fetch(`${NOMINATIM}/search?${params}`, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Nominatim ${res.status}`);
  }
  const rows = await res.json();
  return rows.map((r) => {
    const parts = String(r.display_name ?? "").split(", ");
    return {
      lat: Number(r.lat),
      lon: Number(r.lon),
      label: r.name || parts[0] || "",
      detail: parts.slice(1, 4).join(", "),
    };
  });
}
