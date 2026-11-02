// App state with a tiny subscribe/notify loop. Cards and settings persist in IndexedDB.

import { habitScore, learnedPlaces, recordUse } from "./habits.js";
import { cardsStore, kv, newId } from "./store.js";

export const DEFAULT_SETTINGS = {
  lang: "auto",
  theme: "system",
  radius: 120,
  autoOpen: true,
  osm: true,
  locationWanted: false,
  habits: true,
  aiModel: "claude-opus-5-5",
};

/**
 * @typedef {{ id: string, lat: number, lon: number, label: string, source: string, at: number }} Place
 * @typedef {{
 *   id: string, name: string, code: string, format: string, color: string, category: string,
 *   places: Place[], autoBranches: boolean, photo: string | null, note: string,
 *   createdAt: number, updatedAt: number, lastUsedAt: number, uses: number, sample?: boolean,
 *   points?: number | null, expiry?: string, code2?: string, format2?: string,
 *   usage?: import("./habits.js").UseEvent[], ignoredLearned?: Array<{ lat: number, lon: number }>
 * }} Card
 */

export const state = {
  /** @type {Card[]} */
  cards: [],
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
  const [cards, settings] = await Promise.all([cardsStore.all(), kv.get("settings")]);
  state.cards = cards ?? [];
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
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
