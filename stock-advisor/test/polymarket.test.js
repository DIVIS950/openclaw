import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMarkets, searchMarkets } from "../lib/polymarket.js";

const sample = {
  events: [
    {
      title: "Tesla earnings",
      slug: "tesla-earnings",
      markets: [
        {
          id: 1,
          question: "Will Tesla beat EPS?",
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.62","0.38"]',
          clobTokenIds: '["111","222"]',
          volume: "5000",
        },
        { id: 2, question: "Closed one", closed: true, outcomes: "[]", volume: "9999999" },
      ],
    },
    { title: "Musk", slug: "musk", markets: [{ id: 3, question: "Musk tweets?", outcomes: ["Yes", "No"], outcomePrices: "bad", volume: 9000 }] },
  ],
};

test("extractMarkets parses string-encoded fields and skips closed markets", () => {
  const markets = extractMarkets(sample);
  assert.deepEqual(markets.map((m) => m.id), ["3", "1"]);
  const tesla = markets[1];
  assert.equal(tesla.url, "https://polymarket.com/event/tesla-earnings");
  assert.deepEqual(tesla.outcomes, [
    { name: "Yes", probability: 0.62, tokenId: "111" },
    { name: "No", probability: 0.38, tokenId: "222" },
  ]);
  assert.equal(markets[0].outcomes[0].probability, null);
});

test("searchMarkets dedupes across terms and survives failures", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (url.includes("fail")) throw new Error("network");
    return { ok: true, json: async () => sample };
  };
  const markets = await searchMarkets(["tesla", "fail", "musk"], { fetchImpl });
  assert.equal(calls, 3);
  assert.equal(markets.length, 2);
});
