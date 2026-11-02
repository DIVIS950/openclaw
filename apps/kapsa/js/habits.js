// Smart habits, computed on the phone: when and where you usually use each card.
// Pure functions so they can be unit tested.

import { distanceMeters } from "./geo.js";

const MAX_EVENTS = 60;
const DAY_MS = 86_400_000;

/**
 * @typedef {{ t: number, lat?: number, lon?: number, acc?: number }} UseEvent
 */

/**
 * Add one "card shown" event. Re-opening the same card within 5 minutes counts once.
 * @param {UseEvent[] | undefined} usage
 * @param {number} now ms timestamp
 * @param {{ lat: number, lon: number, accuracy: number } | null} pos
 * @returns {UseEvent[]}
 */
export function recordUse(usage, now, pos) {
  const list = [...(usage ?? [])];
  const event = { t: now };
  if (pos && pos.accuracy <= 150) {
    Object.assign(event, { lat: pos.lat, lon: pos.lon, acc: Math.round(pos.accuracy) });
  }
  const last = list.at(-1);
  if (last && now - last.t < 5 * 60_000) {
    list[list.length - 1] = { ...event, t: last.t, ...(event.lat === undefined ? pickPlace(last) : {}) };
  } else {
    list.push(event);
  }
  return list.slice(-MAX_EVENTS);
}

function pickPlace(e) {
  return e.lat === undefined ? {} : { lat: e.lat, lon: e.lon, acc: e.acc };
}

/** Hours since midnight, local time, with minutes as a fraction. */
function hourOf(t) {
  const d = new Date(t);
  return d.getHours() + d.getMinutes() / 60;
}

const isWeekend = (t) => {
  const day = new Date(t).getDay();
  return day === 0 || day === 6;
};

/**
 * How well "now" matches the times this card was used before.
 * Each past use counts more if it was at a similar time of day, on the same kind of
 * day (weekday/weekend), and recently.
 * @param {UseEvent[] | undefined} usage
 * @param {number} now
 */
export function habitScore(usage, now) {
  let score = 0;
  const hNow = hourOf(now);
  const weekendNow = isWeekend(now);
  const weekdayNow = new Date(now).getDay();
  for (const e of usage ?? []) {
    const ageDays = (now - e.t) / DAY_MS;
    if (ageDays < 0 || ageDays > 120) {
      continue;
    }
    let dh = Math.abs(hourOf(e.t) - hNow);
    dh = Math.min(dh, 24 - dh);
    const timeK = Math.exp(-(dh * dh) / (2 * 1.25 * 1.25));
    let dayK = isWeekend(e.t) === weekendNow ? 1 : 0.35;
    if (new Date(e.t).getDay() === weekdayNow) {
      dayK *= 1.25;
    }
    const recency = Math.exp(-ageDays / 45);
    score += timeK * dayK * recency;
  }
  return score;
}

/**
 * The card you most likely want right now, from habits alone.
 * Needs at least 3 past uses and a clear enough pattern.
 * @template {{ id: string, usage?: UseEvent[] }} C
 * @param {C[]} cards
 * @param {number} now
 * @returns {{ card: C, score: number } | null}
 */
export function suggestNow(cards, now, minScore = 1.4) {
  let best = null;
  for (const card of cards) {
    if ((card.usage?.length ?? 0) < 3) {
      continue;
    }
    const score = habitScore(card.usage, now);
    if (score >= minScore && (!best || score > best.score)) {
      best = { card, score };
    }
  }
  return best;
}

/**
 * Part of the day, for labels like "usually at lunchtime".
 * @param {number} t
 * @returns {"morning" | "noon" | "afternoon" | "evening" | "night"}
 */
export function dayPart(t) {
  const h = hourOf(t);
  if (h >= 5 && h < 11) {
    return "morning";
  }
  if (h >= 11 && h < 14) {
    return "noon";
  }
  if (h >= 14 && h < 18) {
    return "afternoon";
  }
  if (h >= 18 && h < 22.5) {
    return "evening";
  }
  return "night";
}

/** Most common part of the day in a card's history (needs 3+ uses), or null. */
export function usualDayPart(usage) {
  if (!usage || usage.length < 3) {
    return null;
  }
  const counts = new Map();
  for (const e of usage) {
    const part = dayPart(e.t);
    counts.set(part, (counts.get(part) ?? 0) + 1);
  }
  let top = null;
  for (const [part, n] of counts) {
    if (!top || n > top.n) {
      top = { part, n };
    }
  }
  return top && top.n / usage.length >= 0.5 ? top.part : null;
}

/**
 * Places learned from where you showed the card: at least 3 uses within ~90 m,
 * on at least 2 different days. Places the user removed are listed in `ignored`.
 * @param {UseEvent[] | undefined} usage
 * @param {Array<{ lat: number, lon: number }>} [ignored]
 * @returns {Array<{ id: string, lat: number, lon: number, count: number, source: "learned" }>}
 */
export function learnedPlaces(usage, ignored = []) {
  const points = (usage ?? []).filter((e) => typeof e.lat === "number" && typeof e.lon === "number");
  /** @type {Array<{ lat: number, lon: number, members: UseEvent[] }>} */
  const clusters = [];
  for (const p of points) {
    const home = clusters.find((c) => distanceMeters(c, /** @type {{ lat: number, lon: number }} */ (p)) <= 90);
    if (home) {
      home.members.push(p);
      home.lat = home.members.reduce((s, m) => s + (m.lat ?? 0), 0) / home.members.length;
      home.lon = home.members.reduce((s, m) => s + (m.lon ?? 0), 0) / home.members.length;
    } else {
      clusters.push({ lat: p.lat ?? 0, lon: p.lon ?? 0, members: [p] });
    }
  }
  return clusters
    .filter((c) => c.members.length >= 3 && new Set(c.members.map((m) => new Date(m.t).toDateString())).size >= 2)
    .filter((c) => !ignored.some((i) => distanceMeters(i, c) <= 90))
    .map((c) => ({
      id: `learned-${c.lat.toFixed(4)}-${c.lon.toFixed(4)}`,
      lat: c.lat,
      lon: c.lon,
      count: c.members.length,
      source: "learned",
    }));
}
