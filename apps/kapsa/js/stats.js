// Spending and savings numbers for the stats screen. Pure functions, unit tested.

/** Start (inclusive) and end (exclusive) of a calendar month, local time. */
export function monthRange(year, month) {
  return { from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime() };
}

/** Year/month of a timestamp, shifted by `delta` months. */
export function monthOf(t, delta = 0) {
  const d = new Date(t);
  const m = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  return { year: m.getFullYear(), month: m.getMonth() };
}

/**
 * Totals for one month.
 * @param {Array<{ amount: number, saved?: number, at: number, cardId: string | null, shop: string }>} purchases
 * @param {Array<{ used: boolean, usedAt: number, saved: number | null }>} coupons
 * @param {Array<{ id: string, usage?: Array<{ t: number }> }>} cards
 * @param {number} year
 * @param {number} month 0-11
 */
export function monthSummary(purchases, coupons, cards, year, month) {
  const { from, to } = monthRange(year, month);
  const inMonth = (t) => t >= from && t < to;
  const list = purchases.filter((p) => inMonth(p.at));
  const spent = round2(list.reduce((s, p) => s + p.amount, 0));
  const savedPurchases = list.reduce((s, p) => s + (p.saved ?? 0), 0);
  const usedCoupons = coupons.filter((c) => c.used && inMonth(c.usedAt));
  const savedCoupons = usedCoupons.reduce((s, c) => s + (c.saved ?? 0), 0);
  let visits = 0;
  for (const card of cards) {
    visits += (card.usage ?? []).filter((e) => inMonth(e.t)).length;
  }
  return {
    spent,
    saved: round2(savedPurchases + savedCoupons),
    purchases: list.length,
    couponsUsed: usedCoupons.length,
    visits,
  };
}

/**
 * Spending per shop in a month, biggest first. Purchases without a card are
 * grouped by shop name.
 * @param {Array<{ amount: number, at: number, cardId: string | null, shop: string }>} purchases
 * @param {Array<{ id: string, name: string, color: string }>} cards
 */
export function byShop(purchases, cards, year, month) {
  const { from, to } = monthRange(year, month);
  const groups = new Map();
  for (const p of purchases) {
    if (p.at < from || p.at >= to) {
      continue;
    }
    const card = p.cardId ? cards.find((c) => c.id === p.cardId) : null;
    const key = card ? `card:${card.id}` : `shop:${(p.shop || "?").trim().toLowerCase()}`;
    const g = groups.get(key) ?? {
      key,
      cardId: card?.id ?? null,
      name: card?.name ?? (p.shop || "?"),
      color: card?.color ?? null,
      amount: 0,
      count: 0,
    };
    g.amount = round2(g.amount + p.amount);
    g.count += 1;
    groups.set(key, g);
  }
  const rows = [...groups.values()];
  rows.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  return rows;
}

/**
 * Spending for the last `n` months ending with (year, month), oldest first.
 * @param {Array<{ amount: number, at: number }>} purchases
 */
export function trend(purchases, year, month, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(year, month - i, 1);
    const { from, to } = monthRange(m.getFullYear(), m.getMonth());
    const amount = round2(purchases.filter((p) => p.at >= from && p.at < to).reduce((s, p) => s + p.amount, 0));
    out.push({ year: m.getFullYear(), month: m.getMonth(), amount });
  }
  return out;
}

/** Money spent at one card's shop this month, and visits (times the card was shown). */
export function cardMonth(card, purchases, now) {
  const { year, month } = monthOf(now);
  const { from, to } = monthRange(year, month);
  const spent = round2(
    purchases.filter((p) => p.cardId === card.id && p.at >= from && p.at < to).reduce((s, p) => s + p.amount, 0),
  );
  const visits = (card.usage ?? []).filter((e) => e.t >= from && e.t < to).length;
  return { spent, visits };
}

/** "Nice" upper bound for a chart axis: 1, 2, 2.5, 5 × 10^n at or above `max`. */
export function niceMax(max) {
  if (!(max > 0)) {
    return 100;
  }
  const exp = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * exp >= max) {
      return step * exp;
    }
  }
  return 10 * exp;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
