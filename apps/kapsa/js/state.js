// App state with a tiny subscribe/notify loop. Everything persists in IndexedDB on the phone.

import { habitScore, learnedPlaces, recordUse } from "./habits.js";
import { cardsStore, couponsStore, kv, newId, purchasesStore } from "./store.js";

export const DEFAULT_SETTINGS = {
  lang: "auto",
  theme: "light",
  // Look version: older installs followed the phone (often dark); 2.1 moves them to light once.
  look: 2,
  radius: 120,
  autoOpen: true,
  osm: true,
  locationWanted: false,
  habits: true,
  aiModel: "claude-opus-5-5",
  currency: "CZK",
  notifications: false,
  remindDays: 3,
};

/**
 * @typedef {{ id: string, lat: number, lon: number, label: string, source: string, at: number }} Place
 * @typedef {{
 *   id: string, name: string, code: string, format: string, color: string, category: string,
 *   places: Place[], autoBranches: boolean, photo: string | null, note: string,
 *   createdAt: number, updatedAt: number, lastUsedAt: number, uses: number, sample?: boolean,
 *   points?: number | null, expiry?: string, code2?: string, format2?: string,
 *   usage?: import("./habits.js").UseEvent[], ignoredLearned?: Array<{ lat: number, lon: number }>,
 *   stamps?: { goal: number, count: number, reward: string, redeemed: number } | null, pointsGoal?: number | null
 * }} Card
 * @typedef {import("./model.js").Coupon} Coupon
 * @typedef {import("./model.js").Purchase} Purchase
 */

export const state = {
  /** @type {Card[]} */
  cards: [],
  /** @type {Coupon[]} */
  coupons: [],
  /** @type {Purchase[]} */
  purchases: [],
  settings: { ...DEFAULT_SETTINGS },
  /** @type {{ lat: number, lon: number, accuracy: number, at: number } | null} */
  pos: null,
  /** @type {"off" | "searching" | "on" | "denied" | "unavailable"} */
  locStatus: "off",
  /** Branches found on the map for the current area, by card id. */
  /** @type {Record<string, Array<{ id: string, lat: number, lon: number, name: string, address: string }>>} */
  branches: {},
  online: typeof navigator === "undefined" ? true : navigator.onLine,
};

const listeners = new Set();
let scheduled = false;

/** Run `fn` after any state change (batched to one call per frame). */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  if (scheduled) {
    return;
  }
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const fn of listeners) {
      fn();
    }
  });
}

export async function loadState() {
  const [cards, coupons, purchases, settings] = await Promise.all([
    cardsStore.all(),
    couponsStore.all(),
    purchasesStore.all(),
    kv.get("settings"),
  ]);
  state.cards = cards ?? [];
  state.coupons = coupons ?? [];
  state.purchases = purchases ?? [];
  const migrate = settings && settings.look !== DEFAULT_SETTINGS.look;
  state.settings = { ...DEFAULT_SETTINGS, ...settings, ...(migrate ? { theme: "light", look: DEFAULT_SETTINGS.look } : null) };
  if (migrate) {
    await kv.set("settings", state.settings);
  }
}

/** @param {Partial<typeof DEFAULT_SETTINGS>} patch */
export async function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await kv.set("settings", state.settings);
  notify();
}

/** @param {string} id */
export function getCard(id) {
  return state.cards.find((c) => c.id === id) ?? null;
}

/**
 * Create or update a card.
 * @param {Partial<Card> & { name: string }} data
 * @returns {Promise<Card>}
 */
export async function saveCard(data) {
  const now = Date.now();
  const existing = data.id ? getCard(data.id) : null;
  /** @type {Card} */
  const card = {
    id: newId(),
    code: "",
    format: "code128",
    color: "#2B44D6",
    category: "other",
    places: [],
    autoBranches: true,
    photo: null,
    note: "",
    createdAt: now,
    lastUsedAt: 0,
    uses: 0,
    ...existing,
    ...data,
    updatedAt: now,
  };
  await cardsStore.put(card);
  state.cards = [...state.cards.filter((c) => c.id !== card.id), card];
  notify();
  return card;
}

/** @param {string} id */
export async function deleteCard(id) {
  await cardsStore.remove(id);
  state.cards = state.cards.filter((c) => c.id !== id);
  delete state.branches[id];
  // Coupons and purchases stay, with the shop name; they just lose the link.
  for (const c of state.coupons.filter((x) => x.cardId === id)) {
    await saveCoupon({ ...c, cardId: null });
  }
  for (const p of state.purchases.filter((x) => x.cardId === id)) {
    await savePurchase({ ...p, cardId: null });
  }
  notify();
}

// ---------- Stamps and points ----------

/** Add one stamp. Returns the card and whether the reward is now ready. */
export async function addStamp(cardId) {
  const card = getCard(cardId);
  if (!card?.stamps) {
    return { card, ready: false };
  }
  const count = Math.min(card.stamps.goal, card.stamps.count + 1);
  const saved = await saveCard({ ...card, stamps: { ...card.stamps, count } });
  return { card: saved, ready: count >= card.stamps.goal };
}

export async function removeStamp(cardId) {
  const card = getCard(cardId);
  if (!card?.stamps || card.stamps.count === 0) {
    return card;
  }
  return saveCard({ ...card, stamps: { ...card.stamps, count: card.stamps.count - 1 } });
}

/** Use the reward: start a fresh stamp card. */
export async function redeemStamps(cardId) {
  const card = getCard(cardId);
  if (!card?.stamps) {
    return card;
  }
  return saveCard({ ...card, stamps: { ...card.stamps, count: 0, redeemed: card.stamps.redeemed + 1 } });
}

// ---------- Coupons ----------

/** @param {string} id */
export function getCoupon(id) {
  return state.coupons.find((c) => c.id === id) ?? null;
}

/**
 * @param {Partial<Coupon> & { title: string }} data
 * @returns {Promise<Coupon>}
 */
export async function saveCoupon(data) {
  const existing = data.id ? getCoupon(data.id) : null;
  /** @type {Coupon} */
  const coupon = {
    id: newId(),
    discount: "",
    shop: "",
    cardId: null,
    code: "",
    format: "none",
    expiry: "",
    note: "",
    photo: null,
    used: false,
    usedAt: 0,
    saved: null,
    createdAt: Date.now(),
    ...existing,
    ...data,
  };
  await couponsStore.put(coupon);
  state.coupons = [...state.coupons.filter((c) => c.id !== coupon.id), coupon];
  notify();
  return coupon;
}

/**
 * Mark a coupon used; the saving (if given) counts in the stats.
 * @param {string} id
 * @param {number | null} saved
 */
export async function useCoupon(id, saved) {
  const coupon = getCoupon(id);
  if (!coupon) {
    return null;
  }
  return saveCoupon({ ...coupon, used: true, usedAt: Date.now(), saved });
}

export async function deleteCoupon(id) {
  await couponsStore.remove(id);
  state.coupons = state.coupons.filter((c) => c.id !== id);
  notify();
}

/** Coupons that belong to a card: linked by id, or with the same shop name. */
export function couponsForCard(card, coupons = state.coupons) {
  const name = card.name.trim().toLowerCase();
  return coupons.filter((c) => c.cardId === card.id || (!c.cardId && c.shop && c.shop.trim().toLowerCase() === name));
}

// ---------- Purchases ----------

/**
 * @param {Partial<Purchase> & { amount: number }} data
 * @returns {Promise<Purchase>}
 */
export async function savePurchase(data) {
  const existing = data.id ? state.purchases.find((p) => p.id === data.id) : null;
  const card = data.cardId ? getCard(data.cardId) : null;
  /** @type {Purchase} */
  const purchase = {
    id: newId(),
    cardId: null,
    shop: card?.name ?? "",
    saved: 0,
    at: Date.now(),
    note: "",
    source: "manual",
    ...existing,
    ...data,
  };
  await purchasesStore.put(purchase);
  state.purchases = [...state.purchases.filter((p) => p.id !== purchase.id), purchase];
  notify();
  return purchase;
}

export async function deletePurchase(id) {
  await purchasesStore.remove(id);
  state.purchases = state.purchases.filter((p) => p.id !== id);
  notify();
}

/**
 * Add a saved place to a card.
 * @param {string} cardId
 * @param {{ lat: number, lon: number, label?: string, source: string }} place
 */
export async function addPlace(cardId, place) {
  const card = getCard(cardId);
  if (!card) {
    return null;
  }
  const entry = { id: newId(), label: "", at: Date.now(), ...place };
  return saveCard({ ...card, places: [...card.places, entry] });
}

/**
 * @param {string} cardId
 * @param {string} placeId
 */
export async function removePlace(cardId, placeId) {
  const card = getCard(cardId);
  if (!card) {
    return null;
  }
  return saveCard({ ...card, places: card.places.filter((p) => p.id !== placeId) });
}

/** Count a card as shown at the till, and remember when and where (for habits). */
export async function markUsed(cardId) {
  const card = getCard(cardId);
  if (!card) {
    return;
  }
  const now = Date.now();
  const updated = {
    ...card,
    uses: (card.uses ?? 0) + 1,
    lastUsedAt: now,
    usage: state.settings.habits ? recordUse(card.usage, now, state.pos) : card.usage,
  };
  await cardsStore.put(updated);
  state.cards = state.cards.map((c) => (c.id === cardId ? updated : c));
}

/** Places learned from habits for one card (empty when habits are off). */
export function learnedFor(card) {
  return state.settings.habits ? learnedPlaces(card.usage, card.ignoredLearned) : [];
}

/** Map branches plus learned places, by card id, for ranking. */
export function extraPlaces() {
  const out = {};
  for (const card of state.cards) {
    out[card.id] = [...(state.branches[card.id] ?? []), ...learnedFor(card)];
  }
  return out;
}

/** Habit score of every card for this moment. */
export function habitScores(now = Date.now()) {
  const out = {};
  if (state.settings.habits) {
    for (const card of state.cards) {
      out[card.id] = habitScore(card.usage, now);
    }
  }
  return out;
}

/**
 * Stop using a learned place for a card.
 * @param {string} cardId
 * @param {{ lat: number, lon: number }} place
 */
export async function forgetLearned(cardId, place) {
  const card = getCard(cardId);
  if (!card) {
    return null;
  }
  return saveCard({ ...card, ignoredLearned: [...(card.ignoredLearned ?? []), { lat: place.lat, lon: place.lon }] });
}
