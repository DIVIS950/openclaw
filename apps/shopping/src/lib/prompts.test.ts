import { describe, expect, it } from "vitest";
import { cleanCoupons, cleanVerdict, extractJson, heuristicVerdict } from "./prompts";

describe("extractJson", () => {
  it("finds JSON in fences, after narration, or alone", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here it is: [{"code":"X10"}] hope it helps')).toEqual([{ code: "X10" }]);
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("cleanVerdict", () => {
  it("keeps valid verdicts and caps reasons at 3", () => {
    const v = cleanVerdict({ verdict: "wait", headline: "New model soon", reasons: [1, 2, 3, 4].map((i) => ({ kind: i % 2 ? "pro" : "con", text: `r${i}` })) });
    expect(v?.verdict).toBe("wait");
    expect(v?.reasons).toHaveLength(3);
    expect(v?.reasons[1].kind).toBe("con");
  });

  it("rejects unknown verdicts", () => {
    expect(cleanVerdict({ verdict: "maybe" })).toBeNull();
    expect(cleanVerdict(null)).toBeNull();
  });
});

describe("cleanCoupons", () => {
  it("drops codes with spaces or odd characters", () => {
    const c = cleanCoupons([{ code: "RUN10", description: "10% off" }, { code: "not a code" }, { code: "<script>" }, { code: "OK-2026" }]);
    expect(c.map((x) => x.code)).toEqual(["RUN10", "OK-2026"]);
  });

  it("returns an empty list for anything that isn't an array", () => {
    expect(cleanCoupons({ code: "X" })).toEqual([]);
  });
});

describe("heuristicVerdict", () => {
  const offers = [
    { store: "Alza", domain: "alza.cz", price: 90, trust: 95 },
    { store: "Scam", domain: "x.shop", price: 20, trust: 10 },
  ];
  it("says buy when a trusted shop is well under the usual price", () => {
    expect(heuristicVerdict({ title: "X", brand: "Y", typicalPrice: 110, city: "Prague", offers }).verdict).toBe("buy");
  });
  it("ignores scam prices and says wait at the usual price", () => {
    expect(heuristicVerdict({ title: "X", brand: "Y", typicalPrice: 90, city: "Prague", offers }).verdict).toBe("wait");
  });
  it("says skip when no shop is safe", () => {
    expect(heuristicVerdict({ title: "X", brand: "Y", typicalPrice: 90, city: "Prague", offers: [offers[1]] }).verdict).toBe("skip");
  });
});
