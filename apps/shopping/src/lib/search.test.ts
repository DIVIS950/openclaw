import { describe, expect, it } from "vitest";
import { getOffer, getStore, offersFor } from "./data";
import { lineReader, normalize, searchPrompt, type RawProduct } from "./search";

const offer = (extra: Record<string, unknown> = {}) => ({
  store: "Zalando",
  domain: "https://www.zalando.cz/some/page",
  price: 129.95,
  url: "https://www.zalando.cz/p",
  warehouseCity: "Berlin",
  https: true,
  domainAgeYears: 15,
  rating: 4.6,
  reviews: 50000,
  returnsDays: 30,
  flags: [],
  ...extra,
});

describe("normalize", () => {
  it("turns a raw result into a product with offers and stores", () => {
    const p = normalize({ title: "Pegasus 41", brand: "Nike", emoji: "👟", offers: [offer(), offer({ store: "Nike", domain: "nike.com", price: 139.99 })] }, "estimate")!;
    expect(p.title).toBe("Pegasus 41");
    expect(p.source).toBe("estimate");
    const offers = offersFor(p.id);
    expect(offers).toHaveLength(2);
    expect(getStore(offers[0].storeId)!.domain).toBe("www.zalando.cz");
    expect(getOffer(offers[0].id)).toBeDefined();
  });

  it("gives the same product the same id every time", () => {
    const raw: RawProduct = { title: "Clifton 10", brand: "Hoka", offers: [offer()] };
    expect(normalize(raw, "web")!.id).toBe(normalize(raw, "web")!.id);
  });

  it("drops unsafe links and clamps bad numbers", () => {
    const p = normalize({ title: "X", offers: [offer({ url: "javascript:alert(1)", rating: 99, reviews: -5 })] }, "web")!;
    const o = offersFor(p.id)[0];
    expect(o.url).toBeUndefined();
    const s = getStore(o.storeId)!;
    expect(s.rating).toBe(5);
    expect(s.reviews).toBe(0);
  });

  it("falls back to a known city for unknown warehouses", () => {
    const p = normalize({ title: "Y", offers: [offer({ warehouseCity: "Atlantis" })] }, "web")!;
    expect(getStore(offersFor(p.id)[0].storeId)!.warehouse.city).toBe("Berlin");
  });

  it("rejects results without a title or any valid offer", () => {
    expect(normalize({ offers: [offer()] }, "web")).toBeNull();
    expect(normalize({ title: "Z", offers: [offer({ price: 0 }), offer({ price: "free" })] }, "web")).toBeNull();
    expect(normalize({ title: "Z", offers: "nope" }, "web")).toBeNull();
  });
});

describe("lineReader", () => {
  it("emits each object once as text streams in, ignoring narration", () => {
    const got: unknown[] = [];
    const r = lineReader((o) => got.push(o));
    const full = 'Sure, here you go:\n{"title":"A"}\nSome text {"title":"B"}\n```json\n{"title":"C"}\n```';
    for (let i = 1; i <= full.length; i += 3) r.push(full.slice(0, i));
    r.end(full);
    expect(got).toEqual([{ title: "A" }, { title: "B" }, { title: "C" }]);
  });

  it("does not emit a half-written line", () => {
    const got: unknown[] = [];
    const r = lineReader((o) => got.push(o));
    r.push('{"title":"A"}\n{"title":"B');
    expect(got).toHaveLength(1);
  });
});

describe("searchPrompt", () => {
  it("asks for web search only in live mode", () => {
    expect(searchPrompt("shoes", "Prague", true)).toMatch(/web search/i);
    expect(searchPrompt("shoes", "Prague", false)).toMatch(/cannot browse/i);
  });

  it("caps very long queries", () => {
    expect(searchPrompt("a".repeat(5000), "Prague", false).length).toBeLessThan(3000);
  });
});
