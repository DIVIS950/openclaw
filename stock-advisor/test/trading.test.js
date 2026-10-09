import assert from "node:assert/strict";
import { test } from "node:test";
import { placeOrder, tradingConfig, validateOrder, TradeError } from "../lib/trading.js";

const ok = { tokenId: "123", side: "BUY", price: 0.4, size: 10, confirm: true };

test("trading is off unless explicitly enabled with a key", () => {
  assert.equal(tradingConfig({}).enabled, false);
  assert.equal(tradingConfig({ POLYMARKET_TRADING_ENABLED: "true" }).enabled, false);
  assert.equal(tradingConfig({ POLYMARKET_TRADING_ENABLED: "true", POLYMARKET_PRIVATE_KEY: "0xabc" }).enabled, true);
  assert.equal(tradingConfig({}).maxUsd, 25);
});

test("validateOrder accepts a sane order and computes cost", () => {
  const order = validateOrder(ok, { maxUsd: 25 });
  assert.equal(order.cost, 4);
  assert.equal(order.tokenID, "123");
});

test("validateOrder rejects bad or risky orders", () => {
  const bad = [
    { ...ok, confirm: false },
    { ...ok, tokenId: "abc" },
    { ...ok, side: "HOLD" },
    { ...ok, price: 1 },
    { ...ok, price: 0 },
    { ...ok, size: -1 },
    { ...ok, size: 100 }, // $40 > $25 cap
  ];
  for (const body of bad) assert.throws(() => validateOrder(body, { maxUsd: 25 }), TradeError);
});

test("placeOrder refuses when trading is disabled", async () => {
  await assert.rejects(placeOrder(ok, {}), /turned off/);
});
