// Run with: node --test apps/kapsa/tests/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAT_TOOLS, ChatSession, cardsForAssistant, mergeCardReading } from "../js/ai.js";
import { dayPart, habitScore, learnedPlaces, recordUse, suggestNow, usualDayPart } from "../js/habits.js";
import { setLang } from "../js/i18n.js";
import { cleanDate, cleanPoints, expiryStatus, sanitizeCard } from "../js/model.js";

const at = (y, m, d, hh, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();
const SHOP = { lat: 50.08746, lon: 14.42125 };

test("recordUse counts a re-open within 5 minutes once and keeps 60 events", () => {
  let usage = recordUse([], at(2026, 11, 2, 12, 0), { ...SHOP, accuracy: 20 });
  usage = recordUse(usage, at(2026, 11, 2, 12, 3), null);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].lat, SHOP.lat, "keeps the place from the first open");
  usage = recordUse(usage, at(2026, 11, 2, 12, 30), { ...SHOP, accuracy: 900 });
  assert.equal(usage.length, 2);
  assert.equal(usage[1].lat, undefined, "a very inaccurate fix is not stored");
  let many = [];
  for (let i = 0; i < 80; i++) {
    many = recordUse(many, at(2026, 1, 1, 8) + i * 3_600_000, null);
  }
  assert.equal(many.length, 60);
});

test("habitScore prefers the usual time of day", () => {
  // Bageterie at lunch on 4 weekdays.
  const usage = [26, 27, 28, 29].map((d) => ({ t: at(2026, 10, d, 12, 15) }));
  const lunch = habitScore(usage, at(2026, 11, 2, 12, 30));
  const evening = habitScore(usage, at(2026, 11, 2, 20, 0));
  assert.ok(lunch > 2, `lunch ${lunch}`);
  assert.ok(evening < 0.1, `evening ${evening}`);
  assert.equal(habitScore([], at(2026, 11, 2, 12)), 0);
});

test("suggestNow needs at least 3 uses and a clear pattern", () => {
  const lunch = [26, 27, 28, 29].map((d) => ({ t: at(2026, 10, d, 12, 10) }));
  const cards = [
    { id: "bb", usage: lunch },
    { id: "few", usage: lunch.slice(0, 2) },
  ];
  assert.equal(suggestNow(cards, at(2026, 11, 2, 12, 20))?.card.id, "bb");
  assert.equal(suggestNow(cards, at(2026, 11, 2, 3, 0)), null);
});

test("day parts and the usual one", () => {
  assert.equal(dayPart(at(2026, 11, 2, 7)), "morning");
  assert.equal(dayPart(at(2026, 11, 2, 12, 30)), "noon");
  assert.equal(dayPart(at(2026, 11, 2, 16)), "afternoon");
  assert.equal(dayPart(at(2026, 11, 2, 19)), "evening");
  assert.equal(dayPart(at(2026, 11, 2, 2)), "night");
  assert.equal(usualDayPart([{ t: at(2026, 11, 1, 12) }, { t: at(2026, 11, 2, 13) }, { t: at(2026, 11, 3, 18) }]), "noon");
  assert.equal(usualDayPart([]), null);
});

test("learned places need 3 uses on 2 different days, and can be forgotten", () => {
  const near = (dLat) => ({ lat: SHOP.lat + dLat, lon: SHOP.lon, acc: 20 });
  const usage = [
    { t: at(2026, 10, 1, 12), ...near(0) },
    { t: at(2026, 10, 1, 18), ...near(0.0002) },
    { t: at(2026, 10, 2, 12), ...near(-0.0002) },
    { t: at(2026, 10, 3, 9), lat: 50.2, lon: 14.6, acc: 20 },
  ];
  const places = learnedPlaces(usage);
  assert.equal(places.length, 1);
  assert.equal(places[0].count, 3);
  assert.equal(places[0].source, "learned");
  assert.ok(Math.abs(places[0].lat - SHOP.lat) < 0.0002);
  assert.equal(learnedPlaces(usage.slice(0, 2)).length, 0, "two uses are not enough");
  const sameDay = usage.slice(0, 2).concat({ t: at(2026, 10, 1, 20), ...near(0) });
  assert.equal(learnedPlaces(sameDay).length, 0, "one day is not enough");
  assert.equal(learnedPlaces(usage, [SHOP]).length, 0, "ignored by the user");
});

test("expiry status and cleaning of points and dates", () => {
  const now = at(2026, 11, 2, 12);
  assert.equal(expiryStatus("2026-11-02", now)?.state, "soon");
  assert.equal(expiryStatus("2026-11-02", now)?.days, 0);
  assert.equal(expiryStatus("2026-11-12", now)?.days, 10);
  assert.equal(expiryStatus("2027-06-01", now)?.state, "ok");
  assert.equal(expiryStatus("2026-10-01", now)?.state, "expired");
  assert.equal(expiryStatus("", now), null);
  assert.equal(cleanDate("31.12.2026"), "");
  assert.equal(cleanDate("2027-01-31"), "2027-01-31");
  assert.equal(cleanPoints("1 250"), 1250);
  assert.equal(cleanPoints("abc"), null);
  assert.equal(cleanPoints(null), null);
});

test("backups keep the new card fields, cleaned", () => {
  const card = sanitizeCard({
    name: "dm",
    code: "123",
    points: "250",
    expiry: "2027-01-31",
    code2: "ABC",
    format2: "qr",
    usage: [{ t: 1, lat: 50, lon: 14, acc: 10 }, { t: "x" }, { t: 2 }],
    ignoredLearned: [{ lat: 50, lon: 14 }, { lat: 999, lon: 0 }],
  });
  assert.equal(card?.points, 250);
  assert.equal(card?.expiry, "2027-01-31");
  assert.equal(card?.format2, "qr");
  assert.equal(card?.usage.length, 2);
  assert.equal(card?.ignoredLearned.length, 1);
});

test("an AI card reading prefers the code decoded on the phone", () => {
  const ai = {
    is_card: true,
    shop_name: " Bageterie Boulevard ",
    card_number: "4006 3813 3393 1",
    barcode_type: "ean13",
    brand_color: "#1e1e1e",
    category: "bakery",
    expiry: "2027-03-31",
    points: "120",
    note: "Každá 10. bageta zdarma",
  };
  const fromAi = mergeCardReading(ai, null);
  assert.equal(fromAi.code, "4006381333931");
  assert.equal(fromAi.format, "ean13");
  assert.equal(fromAi.name, "Bageterie Boulevard");
  assert.equal(fromAi.color, "#1E1E1E");
  assert.equal(fromAi.points, 120);
  const exact = mergeCardReading(ai, { rawValue: "2990047182631", format: "ean_13" });
  assert.equal(exact.code, "2990047182631");
  const bad = mergeCardReading(
    { ...ai, brand_color: "red", category: "space", expiry: "soon", barcode_type: "weird", card_number: "" },
    null,
  );
  assert.equal(bad.color, null);
  assert.equal(bad.category, null);
  assert.equal(bad.expiry, "");
  assert.equal(bad.format, "none");
});

test("the assistant never sees card numbers", () => {
  const rows = cardsForAssistant(
    [{ id: "a", name: "Albert", code: "SECRET-123", format: "ean13", category: "grocery", places: [], uses: 3, lastUsedAt: 0, note: "", points: 40 }],
    { now: 0, distances: { a: 312.4 }, here: [], usual: { a: "noon" } },
  );
  assert.equal(rows[0].distance_m, 312);
  assert.equal(rows[0].points, 40);
  assert.equal(rows[0].has_barcode, true);
  assert.ok(!JSON.stringify(rows).includes("SECRET-123"));
});

test("chat tools are strict JSON schemas", () => {
  for (const tool of CHAT_TOOLS) {
    assert.equal(tool.strict, true, tool.name);
    assert.equal(tool.input_schema.type, "object");
    assert.equal(tool.input_schema.additionalProperties, false);
    assert.deepEqual(
      [...tool.input_schema.required].toSorted(),
      Object.keys(tool.input_schema.properties).toSorted(),
    );
  }
});

test("chat loop runs tools, sends all results in one message, and collects card buttons", async () => {
  setLang("en");
  const calls = [];
  const replies = [
    {
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "tool_use", id: "t1", name: "list_cards", input: {} },
        { type: "tool_use", id: "t2", name: "show_card", input: { card_id: "bb" } },
      ],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Use your **Bageterie** card." }] },
  ];
  const session = new ChatSession({
    model: () => "claude-opus-5-5",
    send: async (params) => {
      calls.push(structuredClone(params));
      return replies.shift();
    },
    runTool: async (name, input) => (name === "show_card" ? { content: "shown", cardId: input.card_id } : { content: "[]" }),
  });
  const answer = await session.ask("Which card here?", "Local time: noon");
  assert.equal(answer.text, "Use your **Bageterie** card.");
  assert.deepEqual(answer.cardIds, ["bb"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].output_config.effort, "low");
  assert.equal(calls[0].tool_choice, undefined, "no forced tool use");
  const second = calls[1].messages;
  assert.equal(second[1].role, "assistant");
  assert.equal(second[1].content[0].type, "thinking", "assistant turn goes back unchanged");
  assert.equal(second[2].role, "user");
  assert.deepEqual(
    second[2].content.map((b) => b.tool_use_id),
    ["t1", "t2"],
  );
});

test("a failed chat turn is rolled back", async () => {
  const session = new ChatSession({
    model: () => "claude-opus-5-5",
    send: async () => ({ stop_reason: "refusal", content: [] }),
    runTool: async () => ({ content: "" }),
  });
  await assert.rejects(session.ask("hi", "ctx"), (err) => err.code === "refusal");
  assert.equal(session.messages.length, 0);
});

test("coupon and receipt readings are merged and cleaned", async () => {
  const { mergeCouponReading, mergeReceiptReading, couponsForAssistant } = await import("../js/ai.js");
  const c = mergeCouponReading(
    { is_coupon: true, discount: "−20 %", title: "Sleva na drogerii", shop_name: "dm", code: "DM 2026 X", barcode_type: "qr", expiry: "2026-11-30", saving_amount: "", note: "" },
    null,
  );
  assert.equal(c.code, "DM2026X");
  assert.equal(c.format, "qr");
  assert.equal(c.saved, null);
  const exact = mergeCouponReading({ code: "", barcode_type: "unknown" }, { rawValue: "123", format: "ean_8" });
  assert.equal(exact.format, "ean8");
  const r = mergeReceiptReading({ is_receipt: true, shop_name: "Albert", total: "412.50", currency: "CZK", date: "2026-11-02", saved: "23", items: 7 });
  assert.deepEqual(r, { shop: "Albert", amount: 412.5, currency: "CZK", date: "2026-11-02", saved: 23, isReceipt: true });
  const list = couponsForAssistant(
    [
      { id: "c1", title: "Sleva", discount: "−20 %", shop: "dm", cardId: null, code: "SECRET", expiry: "2026-11-30", used: false, note: "" },
      { id: "c2", title: "Old", discount: "", shop: "", cardId: null, code: "", expiry: "", used: true, note: "" },
    ],
    { now: 0, includeUsed: false, daysLeft: () => 27 },
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].days_left, 27);
  assert.ok(!JSON.stringify(list).includes("SECRET"));
});
