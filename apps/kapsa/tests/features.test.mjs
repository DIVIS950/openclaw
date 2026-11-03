// Run with: node --test apps/kapsa/tests/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanMoney, cleanStamps, parseBackup, buildBackup, sanitizeCoupon, sanitizePurchase } from "../js/model.js";
import { collectReminders, reminderRoute } from "../js/reminders.js";
import { byShop, cardMonth, monthSummary, niceMax, trend } from "../js/stats.js";
import { buildIcs } from "../js/util.js";

const at = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh).getTime();

test("money amounts in Czech and English formats", () => {
  assert.equal(cleanMoney("1 234,50"), 1234.5);
  assert.equal(cleanMoney("1.234,50"), 1234.5);
  assert.equal(cleanMoney("1,234.50"), 1234.5);
  assert.equal(cleanMoney("89 Kč"), 89);
  assert.equal(cleanMoney(""), null);
  assert.equal(cleanMoney("abc"), null);
});

test("stamp cards are kept within sane limits", () => {
  assert.deepEqual(cleanStamps({ goal: 10, count: 14, reward: "Bageta zdarma" }), { goal: 10, count: 10, reward: "Bageta zdarma", redeemed: 0 });
  assert.equal(cleanStamps({ goal: 1 }), null);
  assert.equal(cleanStamps({ goal: 99 }), null);
  assert.equal(cleanStamps(null), null);
});

test("coupons and purchases from files are cleaned", () => {
  const c = sanitizeCoupon({ discount: "−20 %", shop: "dm", code: "ABC", expiry: "2026-11-10", photo: "javascript:alert(1)" });
  assert.equal(c?.title, "−20 %");
  assert.equal(c?.format, "code128");
  assert.equal(c?.photo, null);
  assert.equal(sanitizeCoupon({ note: "no title" }), null);
  assert.equal(sanitizePurchase({ amount: "129,90", shop: "Albert" })?.amount, 129.9);
  assert.equal(sanitizePurchase({ amount: -5 }), null);
});

test("backup v2 round-trips cards, coupons and purchases; v1 still loads", () => {
  const text = buildBackup([{ name: "Albert", code: "1" }], [{ title: "Sleva", discount: "−50 Kč" }], [{ amount: 100, shop: "Albert" }]);
  const data = parseBackup(text);
  assert.equal(data?.cards.length, 1);
  assert.equal(data?.coupons.length, 1);
  assert.equal(data?.purchases.length, 1);
  const v1 = parseBackup(JSON.stringify({ app: "kapsa", version: 1, cards: [{ name: "dm" }] }));
  assert.equal(v1?.cards.length, 1);
  assert.equal(v1?.coupons.length, 0);
  assert.equal(parseBackup("{}"), null);
});

test("month summary adds purchases, coupon savings and visits", () => {
  const purchases = [
    { amount: 120, saved: 10, at: at(2026, 11, 2), cardId: "a", shop: "Albert" },
    { amount: 80, saved: 0, at: at(2026, 11, 3), cardId: null, shop: "Pekárna" },
    { amount: 999, saved: 0, at: at(2026, 10, 20), cardId: "a", shop: "Albert" },
  ];
  const coupons = [{ used: true, usedAt: at(2026, 11, 2), saved: 25 }, { used: false, usedAt: 0, saved: null }];
  const cards = [{ id: "a", usage: [{ t: at(2026, 11, 1) }, { t: at(2026, 10, 1) }] }];
  const s = monthSummary(purchases, coupons, cards, 2026, 10);
  assert.deepEqual(s, { spent: 200, saved: 35, purchases: 2, couponsUsed: 1, visits: 1 });
  const shops = byShop(purchases, [{ id: "a", name: "Albert", color: "#003C8F" }], 2026, 10);
  assert.deepEqual(
    shops.map((r) => [r.name, r.amount]),
    [
      ["Albert", 120],
      ["Pekárna", 80],
    ],
  );
  const t6 = trend(purchases, 2026, 10, 6);
  assert.equal(t6.length, 6);
  assert.equal(t6[5].amount, 200);
  assert.equal(t6[4].amount, 999);
  assert.equal(t6[0].month, 5);
  assert.deepEqual(cardMonth(cards[0], purchases, at(2026, 11, 5)), { spent: 120, visits: 1 });
});

test("nice axis maximum", () => {
  assert.equal(niceMax(830), 1000);
  assert.equal(niceMax(2100), 2500);
  assert.equal(niceMax(0), 100);
});

test("reminders: expiring coupons, rewards, coupons here", () => {
  const now = at(2026, 11, 3, 9);
  const cards = [
    { id: "bb", name: "Bageterie", color: "#1E1E1E", stamps: { goal: 10, count: 10, reward: "Bageta", redeemed: 0 } },
    { id: "dm", name: "dm", color: "#1D3A8A", expiry: "2026-11-05" },
  ];
  const coupons = [
    { id: "c1", title: "Sleva", discount: "−20 %", cardId: "dm", expiry: "2026-11-04", used: false },
    { id: "c2", title: "Old", discount: "", cardId: null, expiry: "2026-10-30", used: false },
    { id: "c3", title: "Used", discount: "", cardId: null, expiry: "2026-11-04", used: true },
    { id: "c4", title: "Later", discount: "", cardId: null, expiry: "2026-12-30", used: false },
  ];
  const list = collectReminders({ cards, coupons, now, days: 3, hereCardIds: ["dm"] });
  const kinds = list.map((r) => `${r.kind}:${r.ref}`);
  assert.deepEqual(kinds, ["coupon-here:c1", "reward:bb", "coupon-expiring:c1", "card-expiring:dm", "coupon-expired:c2"]);
  assert.equal(list.find((r) => r.kind === "coupon-expiring")?.days, 1);
  assert.equal(reminderRoute(list[0]), "#coupon-c1");
  assert.equal(reminderRoute(list[1]), "#card-bb");
});

test("calendar file has an all-day event with an alarm", () => {
  const ics = buildIcs({ title: "Kupón dm; −20 %", date: "2026-11-30", uid: "c1" });
  assert.match(ics, /DTSTART;VALUE=DATE:20261130/);
  assert.match(ics, /DTEND;VALUE=DATE:20261201/);
  assert.match(ics, /SUMMARY:Kupón dm\\; −20 %/);
  assert.match(ics, /BEGIN:VALARM/);
});
