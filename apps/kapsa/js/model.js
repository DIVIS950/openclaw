// Card validation for data that comes from outside the app (backups, shared links).

import { FORMATS } from "./barcode.js";
import { CATEGORIES } from "./brands.js";

const HEX = /^#[0-9a-f]{6}$/i;
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i;

const clampText = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isLatLon = (p) => p && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** "2027-03-31" style date, or "" when missing or invalid. */
export function cleanDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "";
  }
  return Number.isNaN(Date.parse(`${value}T00:00:00`)) ? "" : value;
}

/**
 * How soon a card expires.
 * @param {string | undefined} expiry "YYYY-MM-DD"
 * @param {number} now
 * @returns {{ days: number, state: "ok" | "soon" | "expired" } | null}
 */
export function expiryStatus(expiry, now) {
  const date = cleanDate(expiry);
  if (!date) {
    return null;
  }
  // Valid through the end of that day, in local time.
  const end = new Date(`${date}T23:59:59`).getTime();
  const days = Math.ceil((end - now) / 86_400_000) - 1;
  if (end < now) {
    return { days, state: "expired" };
  }
  return { days: Math.max(0, days), state: days <= 30 ? "soon" : "ok" };
}

/** Points balance as a whole number, or null. */
export function cleanPoints(value) {
  const n = typeof value === "string" ? Number(value.replace(/[\s,]/g, "")) : value;
  return isNum(n) && Math.abs(n) < 1e9 ? Math.round(n) : null;
}

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
        .filter(isLatLon)
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
    points: cleanPoints(raw.points),
    expiry: cleanDate(raw.expiry),
    code2: clampText(raw.code2, 512).trim(),
    format2:
      typeof raw.format2 === "string" && raw.format2 in FORMATS ? raw.format2 : clampText(raw.code2, 512).trim() ? "code128" : "none",
    usage: Array.isArray(raw.usage)
      ? raw.usage
          .filter((e) => e && isNum(e.t))
          .slice(-60)
          .map((e) => (isLatLon(e) ? { t: e.t, lat: e.lat, lon: e.lon, acc: isNum(e.acc) ? e.acc : 50 } : { t: e.t }))
      : [],
    ignoredLearned: Array.isArray(raw.ignoredLearned)
      ? raw.ignoredLearned.filter(isLatLon).slice(0, 50).map((p) => ({ lat: p.lat, lon: p.lon }))
      : [],
    stamps: cleanStamps(raw.stamps),
    pointsGoal: cleanPoints(raw.pointsGoal),
  };
}

/**
 * Stamp card: `goal` stamps earn `reward`. `count` is stamps collected now,
 * `redeemed` how many rewards were used so far.
 * @param {any} raw
 * @returns {{ goal: number, count: number, reward: string, redeemed: number } | null}
 */
export function cleanStamps(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const goal = Math.round(Number(raw.goal));
  if (!Number.isFinite(goal) || goal < 2 || goal > 30) {
    return null;
  }
  const count = Math.max(0, Math.min(goal, Math.round(Number(raw.count) || 0)));
  return {
    goal,
    count,
    reward: clampText(raw.reward, 80).trim(),
    redeemed: Math.max(0, Math.round(Number(raw.redeemed) || 0)),
  };
}

/**
 * @typedef {{
 *   id: string, title: string, discount: string, shop: string, cardId: string | null,
 *   code: string, format: string, expiry: string, note: string, photo: string | null,
 *   used: boolean, usedAt: number, saved: number | null, createdAt: number, sample?: boolean
 * }} Coupon
 */

/**
 * Clean an untrusted coupon (backup file). Returns null when unusable.
 * @param {any} raw
 * @returns {Partial<Coupon> & { title: string } | null}
 */
export function sanitizeCoupon(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const title = clampText(raw.title, 100).trim();
  const discount = clampText(raw.discount, 24).trim();
  if (!title && !discount) {
    return null;
  }
  const code = clampText(raw.code, 512).trim();
  return {
    id: typeof raw.id === "string" && /^[a-z0-9]{6,32}$/i.test(raw.id) ? raw.id : undefined,
    title: title || discount,
    discount,
    shop: clampText(raw.shop, 80).trim(),
    cardId: typeof raw.cardId === "string" && /^[a-z0-9]{6,32}$/i.test(raw.cardId) ? raw.cardId : null,
    code,
    format: typeof raw.format === "string" && raw.format in FORMATS ? raw.format : code ? "code128" : "none",
    expiry: cleanDate(raw.expiry),
    note: clampText(raw.note, 300),
    photo: typeof raw.photo === "string" && PHOTO.test(raw.photo) ? raw.photo : null,
    used: raw.used === true,
    usedAt: isNum(raw.usedAt) ? raw.usedAt : 0,
    saved: cleanMoney(raw.saved),
    createdAt: isNum(raw.createdAt) ? raw.createdAt : Date.now(),
    sample: raw.sample === true ? true : undefined,
  };
}

/**
 * @typedef {{
 *   id: string, cardId: string | null, shop: string, amount: number, saved: number,
 *   at: number, note: string, source: string, sample?: boolean
 * }} Purchase
 */

/** Money amount (2 decimals), or null. Accepts "1 234,50" and "1,234.50". */
export function cleanMoney(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  let n = value;
  if (typeof value === "string") {
    let s = value.replace(/[^\d,.-]/g, "");
    if (!/\d/.test(s)) {
      return null;
    }
    // "1.234,50" or "1 234,50" -> decimal comma; "1,234.50" -> decimal point.
    if (s.includes(",") && (!s.includes(".") || s.lastIndexOf(",") > s.lastIndexOf("."))) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
    n = Number(s);
  }
  return isNum(n) && Math.abs(n) < 1e8 ? Math.round(n * 100) / 100 : null;
}

/**
 * @param {any} raw
 * @returns {Partial<Purchase> & { amount: number } | null}
 */
export function sanitizePurchase(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const amount = cleanMoney(raw.amount);
  if (amount === null || amount < 0) {
    return null;
  }
  return {
    id: typeof raw.id === "string" && /^[a-z0-9]{6,32}$/i.test(raw.id) ? raw.id : undefined,
    cardId: typeof raw.cardId === "string" && /^[a-z0-9]{6,32}$/i.test(raw.cardId) ? raw.cardId : null,
    shop: clampText(raw.shop, 80).trim(),
    amount,
    saved: Math.max(0, cleanMoney(raw.saved) ?? 0),
    at: isNum(raw.at) ? raw.at : Date.now(),
    note: clampText(raw.note, 200),
    source: raw.source === "receipt" ? "receipt" : "manual",
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
  return {
    cards: data.cards.map(sanitizeCard).filter(Boolean),
    coupons: (Array.isArray(data.coupons) ? data.coupons : []).map(sanitizeCoupon).filter(Boolean),
    purchases: (Array.isArray(data.purchases) ? data.purchases : []).map(sanitizePurchase).filter(Boolean),
  };
}

/** Everything in one JSON file (v2 adds coupons and purchases; v1 files still load). */
export function buildBackup(cards, coupons = [], purchases = []) {
  return JSON.stringify(
    { app: "kapsa", version: 2, exportedAt: new Date().toISOString(), cards, coupons, purchases },
    null,
    2,
  );
}

/** URL-safe base64 of UTF-8 text. */
export function encodeShare(card) {
  const { name, code, format, color, category, places, note, autoBranches, expiry, code2, format2, stamps } = card;
  const json = JSON.stringify({
    name,
    code,
    format,
    color,
    category,
    places,
    note,
    autoBranches,
    expiry,
    code2,
    format2,
    stamps: stamps ? { ...stamps, count: 0, redeemed: 0 } : null,
  });
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
