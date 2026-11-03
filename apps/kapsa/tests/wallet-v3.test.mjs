// Run with: node --test apps/kapsa/tests/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCardReading } from "../js/ai.js";
import { BRANDS, cardDomain, cleanDomain, logoUrl } from "../js/brands.js";
import { LEAVE_GRACE_MS, REPEAT_AFTER_MS, dwellPending, dwellStep, emptyDwell } from "../js/dwell.js";
import { DARK_INK, cardLook, hexToHsl } from "../js/look.js";
import { decodeShare, encodeShare, sanitizeCard, sanitizePurchase } from "../js/model.js";
import { collectReminders, reminderRoute } from "../js/reminders.js";

const MIN = 60_000;

test("gift cards keep balance, PIN and kind; loyalty cards don't get a balance", () => {
  const gift = sanitizeCard({ name: "IKEA", kind: "gift", balance: "1 500", initialBalance: 2000, pin: " 48 21 ", website: "https://www.IKEA.com/cz" });
  assert.equal(gift?.kind, "gift");
  assert.equal(gift?.balance, 1500);
  assert.equal(gift?.initialBalance, 2000);
  assert.equal(gift?.pin, "48 21");
  assert.equal(gift?.website, "ikea.com");
  const neg = sanitizeCard({ name: "X", kind: "gift", balance: -20 });
  assert.equal(neg?.balance, 0);
  const loyal = sanitizeCard({ name: "Albert", balance: 300, kind: "weird" });
  assert.equal(loyal?.kind, "loyalty");
  assert.equal(loyal?.balance, null);
  assert.equal(sanitizePurchase({ amount: 120, source: "gift" })?.source, "gift");
  assert.equal(sanitizePurchase({ amount: 120, source: "hack" })?.source, "manual");
});

test("logos: own picture first, then the shop's website, and never invalid data", () => {
  assert.equal(cleanDomain("https://www.Albert.cz/akce?x=1"), "albert.cz");
  assert.equal(cleanDomain("javascript:alert(1)"), "");
  assert.equal(cleanDomain("not a site"), "");
  assert.equal(cardDomain({ name: "Albert" }), "albert.cz");
  assert.equal(cardDomain({ name: "My café", website: "mycafe.cz" }), "mycafe.cz");
  assert.match(logoUrl({ name: "Albert" }, true) ?? "", /^https:\/\/www\.google\.com\/s2\/favicons\?domain=albert\.cz&sz=128$/);
  assert.equal(logoUrl({ name: "Albert" }, false), null, "no requests when logos are off");
  const own = "data:image/png;base64,AAAA";
  assert.equal(logoUrl({ name: "Albert", logo: own }, true), own);
  assert.equal(sanitizeCard({ name: "A", logo: "data:image/svg+xml;base64,AAAA" })?.logo, null);
  assert.ok(BRANDS.every((b) => cleanDomain(b.domain) === b.domain), "every chain has a clean domain");
});

test("card colours: bright gradients, black cards turn bright, readable text", () => {
  const black = cardLook({ color: "#1E1E1E", category: "bakery" });
  assert.ok(hexToHsl(black.from).l > 0.5 && hexToHsl(black.to).l > 0.4, "a black bakery card becomes bright");
  const navy = cardLook({ color: "#003C8F", category: "grocery" });
  assert.ok(hexToHsl(navy.to).l >= 0.35, "dark brand colours are lifted");
  assert.equal(navy.ink, "#FFFFFF");
  const yellow = cardLook({ color: "#FFD23F", category: "beauty" });
  assert.equal(yellow.ink, DARK_INK, "yellow cards get dark (brown, not black) text");
  const gift = cardLook({ color: "", category: "other", kind: "gift" });
  assert.match(gift.from, /^#[0-9A-F]{6}$/);
  for (const c of ["#000000", "#FFFFFF", "#808080", "#E6E1D6", "#C8102E", "#2F9E44"]) {
    const l = cardLook({ color: c, category: "other" });
    assert.match(l.from + l.to, /^#[0-9A-F]{6}#[0-9A-F]{6}$/, c);
    assert.notEqual(l.to, "#000000", c);
  }
});

test("use-your-card reminder after 2 minutes in the shop, once per visit", () => {
  const th = 2 * MIN;
  let st = emptyDwell();
  let r = dwellStep(st, { hereIds: ["bb"], now: 0, thresholdMs: th });
  assert.deepEqual(r.due, []);
  assert.ok(dwellPending(r.next, 0, th));
  r = dwellStep(r.next, { hereIds: ["bb"], now: 1.5 * MIN, thresholdMs: th });
  assert.deepEqual(r.due, []);
  // A short GPS jump outside doesn't restart the clock.
  r = dwellStep(r.next, { hereIds: [], now: 1.7 * MIN, thresholdMs: th });
  r = dwellStep(r.next, { hereIds: ["bb"], now: 2 * MIN, thresholdMs: th });
  assert.deepEqual(r.due, ["bb"]);
  r = dwellStep(r.next, { hereIds: ["bb"], now: 5 * MIN, thresholdMs: th });
  assert.deepEqual(r.due, [], "only once");
  assert.ok(!dwellPending(r.next, 5 * MIN, th));
  // Leave for real, come back much later: a new reminder.
  st = dwellStep(r.next, { hereIds: [], now: 5 * MIN + LEAVE_GRACE_MS + 1, thresholdMs: th }).next;
  assert.equal(st.since.bb, undefined);
  const later = 2 * MIN + REPEAT_AFTER_MS + 1;
  st = dwellStep(st, { hereIds: ["bb"], now: later, thresholdMs: th }).next;
  assert.deepEqual(dwellStep(st, { hereIds: ["bb"], now: later + th, thresholdMs: th }).due, ["bb"]);
  // Passing by for one minute: nothing.
  let walk = dwellStep(emptyDwell(), { hereIds: ["dm"], now: 0, thresholdMs: th }).next;
  walk = dwellStep(walk, { hereIds: [], now: MIN, thresholdMs: th }).next;
  assert.deepEqual(dwellStep(walk, { hereIds: [], now: 3 * MIN, thresholdMs: th }).due, []);
});

test("gift card reminders: expiring with money left, and when you're in the shop", () => {
  const now = new Date(2026, 10, 3, 12).getTime();
  const cards = [
    { id: "ik", name: "IKEA", kind: "gift", balance: 1500, expiry: "2026-11-12" },
    { id: "empty", name: "H&M", kind: "gift", balance: 0, expiry: "2026-11-05" },
    { id: "al", name: "Albert", kind: "loyalty" },
  ];
  const list = collectReminders({ cards, coupons: [], now, days: 3, hereCardIds: ["ik"] });
  assert.deepEqual(
    list.map((r) => r.kind),
    ["gift-here", "gift-expiring"],
  );
  assert.equal(list[1].amount, 1500);
  assert.equal(list[1].days, 9, "gift cards warn two weeks ahead");
  assert.equal(reminderRoute(list[0]), "#card-ik");
});

test("share links never carry a gift card's PIN or balance", () => {
  const link = encodeShare({ name: "IKEA", code: "123", format: "code128", kind: "gift", balance: 900, pin: "4821", website: "ikea.com", places: [] });
  const back = decodeShare(link);
  assert.equal(back?.kind, "gift");
  assert.equal(back?.pin, "");
  assert.equal(back?.balance, null);
  assert.equal(back?.website, "ikea.com");
});

test("an AI reading of a gift card", () => {
  const r = mergeCardReading(
    { is_card: false, is_gift_card: true, shop_name: "IKEA", card_number: "6001 2345", barcode_type: "code128", brand_color: "#0058A3", category: "home", expiry: "2027-05-01", points: "", note: "", gift_value: "2 000", pin: "48 21", website: "www.ikea.com" },
    null,
  );
  assert.equal(r.isCard, true);
  assert.equal(r.kind, "gift");
  assert.equal(r.balance, 2000);
  assert.equal(r.pin, "4821");
  assert.equal(r.website, "ikea.com");
});
