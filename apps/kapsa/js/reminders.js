// Reminders: what needs attention (expiring coupons and cards, rewards ready,
// coupons for the shop you're in). `collectReminders` is pure and unit tested;
// the rest shows system notifications where the phone allows it.

import { expiryStatus } from "./model.js";

const DAY = 86_400_000;

/**
 * @param {{
 *   cards: Array<any>, coupons: Array<any>, now: number, days: number,
 *   hereCardIds?: string[]
 * }} input
 * @returns {Array<{ id: string, kind: "coupon-expiring" | "coupon-expired" | "card-expiring" | "card-expired" | "reward" | "coupon-here" | "points-goal", ref: string, days?: number, title: string, color?: string }>}
 */
export function collectReminders({ cards, coupons, now, days, hereCardIds = [] }) {
  const out = [];
  const here = new Set(hereCardIds);
  for (const c of coupons) {
    if (c.used) {
      continue;
    }
    const exp = expiryStatus(c.expiry, now);
    const card = c.cardId ? cards.find((x) => x.id === c.cardId) : null;
    const title = [c.discount, c.title].filter(Boolean).join(" · ") || c.title;
    if (exp?.state === "expired") {
      // Only for a week after expiry, then it's just history.
      if (now - new Date(`${c.expiry}T23:59:59`).getTime() < 7 * DAY) {
        out.push({ id: `cx:${c.id}`, kind: "coupon-expired", ref: c.id, title, color: card?.color });
      }
    } else if (exp && exp.days <= days) {
      out.push({ id: `ce:${c.id}:${c.expiry}`, kind: "coupon-expiring", ref: c.id, days: exp.days, title, color: card?.color });
    }
    if (card && here.has(card.id)) {
      out.push({ id: `ch:${c.id}`, kind: "coupon-here", ref: c.id, title, color: card.color });
    }
  }
  for (const card of cards) {
    const exp = expiryStatus(card.expiry, now);
    if (exp?.state === "expired") {
      out.push({ id: `kx:${card.id}`, kind: "card-expired", ref: card.id, title: card.name, color: card.color });
    } else if (exp && exp.days <= Math.max(days, 7)) {
      out.push({ id: `ke:${card.id}:${card.expiry}`, kind: "card-expiring", ref: card.id, days: exp.days, title: card.name, color: card.color });
    }
    if (card.stamps && card.stamps.count >= card.stamps.goal) {
      out.push({ id: `rw:${card.id}:${card.stamps.redeemed}`, kind: "reward", ref: card.id, title: card.name, color: card.color });
    }
    if (card.pointsGoal && card.points !== null && card.points !== undefined && card.points >= card.pointsGoal) {
      out.push({ id: `pg:${card.id}:${card.pointsGoal}`, kind: "points-goal", ref: card.id, title: card.name, color: card.color });
    }
  }
  const order = { "coupon-here": 0, reward: 1, "points-goal": 2, "coupon-expiring": 3, "card-expiring": 4, "coupon-expired": 5, "card-expired": 6 };
  out.sort((a, b) => order[a.kind] - order[b.kind] || (a.days ?? 99) - (b.days ?? 99));
  return out;
}

/** Route that opens the thing a reminder is about. */
export function reminderRoute(r) {
  return r.kind.startsWith("coupon") ? `#coupon-${r.ref}` : `#card-${r.ref}`;
}

// ---------- System notifications ----------

export function notificationsSupported() {
  return typeof Notification !== "undefined" && "serviceWorker" in navigator;
}

export async function askNotificationPermission() {
  if (!notificationsSupported()) {
    return "unsupported";
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * Show each reminder once (remembered by id in `seen`). Returns the ids shown.
 * @param {Array<{ id: string, title: string }>} reminders
 * @param {Set<string>} seen
 * @param {(r: any) => { title: string, body: string, url: string }} format
 */
export async function notifyNew(reminders, seen, format) {
  if (!notificationsSupported() || Notification.permission !== "granted") {
    return [];
  }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    return [];
  }
  const shown = [];
  for (const r of reminders) {
    if (seen.has(r.id)) {
      continue;
    }
    const n = format(r);
    try {
      await reg.showNotification(n.title, {
        body: n.body,
        tag: r.id,
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        data: { url: n.url },
      });
      shown.push(r.id);
    } catch {
      break;
    }
  }
  return shown;
}

/** Ask Chrome (Android, installed app) to wake the app daily to check for expiring coupons. */
export async function registerDailyCheck() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg && "periodicSync" in reg) {
      await /** @type {any} */ (reg).periodicSync.register("kapsa-reminders", { minInterval: 12 * 3600 * 1000 });
      return true;
    }
  } catch {
    // Not allowed (not installed, or the browser said no): in-app reminders still work.
  }
  return false;
}
