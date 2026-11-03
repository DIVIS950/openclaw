// Reminders: what needs attention (expiring coupons, cards and gift cards, rewards
// ready, coupons and gift cards for the shop you're in). `collectReminders` is pure and unit tested;
// the rest shows system notifications where the phone allows it.

import { expiryStatus } from "./model.js";

const DAY = 86_400_000;

/**
 * @param {{
 *   cards: Array<any>, coupons: Array<any>, now: number, days: number,
 *   hereCardIds?: string[]
 * }} input
 * @returns {Array<{ id: string, kind: "coupon-expiring" | "coupon-expired" | "card-expiring" | "card-expired" | "reward" | "coupon-here" | "points-goal" | "gift-here" | "gift-expiring" | "gift-expired", ref: string, days?: number, title: string, color?: string, amount?: number }>}
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
    if (card.kind === "gift") {
      // Money on a gift card: remind earlier (two weeks), and only while some is left.
      const amount = card.balance ?? 0;
      if (amount <= 0) {
        continue;
      }
      const base = { ref: card.id, title: card.name, color: card.color, amount };
      if (exp?.state === "expired") {
        if (now - new Date(`${card.expiry}T23:59:59`).getTime() < 7 * DAY) {
          out.push({ id: `gx:${card.id}`, kind: "gift-expired", ...base });
        }
      } else if (exp && exp.days <= Math.max(days, 14)) {
        out.push({ id: `ge:${card.id}:${card.expiry}`, kind: "gift-expiring", days: exp.days, ...base });
      }
      if (here.has(card.id) && exp?.state !== "expired") {
        out.push({ id: `gh:${card.id}`, kind: "gift-here", ...base });
      }
      continue;
    }
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
  const order = {
    "coupon-here": 0,
    "gift-here": 1,
    reward: 2,
    "points-goal": 3,
    "gift-expiring": 4,
    "coupon-expiring": 5,
    "card-expiring": 6,
    "gift-expired": 7,
    "coupon-expired": 8,
    "card-expired": 9,
  };
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

/**
 * One phone notification right now. Returns false when not allowed.
 * @param {{ title: string, body: string, url: string, tag: string }} n
 */
export async function showNotice(n) {
  if (!notificationsSupported() || Notification.permission !== "granted") {
    return false;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      return false;
    }
    await reg.showNotification(n.title, {
      body: n.body,
      tag: n.tag,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: n.url },
      // @ts-ignore: vibration pattern is supported on Android.
      vibrate: [40, 80, 40],
    });
    return true;
  } catch {
    return false;
  }
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
