// Card validation for data that comes from outside the app (backups, shared links).

import { FORMATS } from "./barcode.js";
import { CATEGORIES } from "./brands.js";

const HEX = /^#[0-9a-f]{6}$/i;
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i;

const clampText = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Clean up an untrusted card object. Returns null when it is not usable.
 * @param {any} raw
 * @returns {Partial<import("./state.js").Card> & { name: string } | null}
 */
export function sanitizeCard(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const name = clampText(raw.name, 80).trim();
  const code = clampText(raw.code, 512).trim();
  if (!name) {
    return null;
  }
  const format = typeof raw.format === "string" && raw.format in FORMATS ? raw.format : code ? "code128" : "none";
  const places = Array.isArray(raw.places)
    ? raw.places
        .filter((p) => p && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
        .slice(0, 50)
        .map((p) => ({
          id: clampText(p.id, 32) || Math.random().toString(36).slice(2, 12),
          lat: p.lat,
          lon: p.lon,
          label: clampText(p.label, 120),
          source: clampText(p.source, 16) || "manual",
          at: isNum(p.at) ? p.at : Date.now(),
        }))
    : [];
  return {
    id: typeof raw.id === "string" && /^[a-z0-9]{6,32}$/i.test(raw.id) ? raw.id : undefined,
    name,
    code,
    format,
    color: typeof raw.color === "string" && HEX.test(raw.color) ? raw.color : "#2B44D6",
    category: CATEGORIES.some((c) => c.id === raw.category) ? raw.category : "other",
    places,
    autoBranches: raw.autoBranches !== false,
    photo: typeof raw.photo === "string" && PHOTO.test(raw.photo) ? raw.photo : null,
    note: clampText(raw.note, 500),
    uses: isNum(raw.uses) ? raw.uses : 0,
    lastUsedAt: isNum(raw.lastUsedAt) ? raw.lastUsedAt : 0,
    createdAt: isNum(raw.createdAt) ? raw.createdAt : Date.now(),
    sample: raw.sample === true ? true : undefined,
  };
}

/**
 * Parse a backup file's JSON text.
 * @param {string} text
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || data.app !== "kapsa" || !Array.isArray(data.cards)) {
    return null;
  }
  return data.cards.map(sanitizeCard).filter(Boolean);
}

/** @param {import("./state.js").Card[]} cards */
export function buildBackup(cards) {
  return JSON.stringify({ app: "kapsa", version: 1, exportedAt: new Date().toISOString(), cards }, null, 2);
}

/** URL-safe base64 of UTF-8 text. */
export function encodeShare(card) {
  const { name, code, format, color, category, places, note, autoBranches } = card;
  const json = JSON.stringify({ name, code, format, color, category, places, note, autoBranches });
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** @param {string} encoded */
export function decodeShare(encoded) {
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const card = sanitizeCard(JSON.parse(new TextDecoder().decode(bytes)));
    if (card) {
      delete card.id;
    }
    return card;
  } catch {
    return null;
  }
}
