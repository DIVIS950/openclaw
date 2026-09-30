import { describe, expect, it } from "vitest";
import { OFFERS } from "./data";
import { normalizeDomain, OrderInput, priceOrder } from "./order-pricing";
import { carrierTrackingUrl, serviceFee } from "./order-types";

const base = {
  customer: { name: "Jana Novak", email: "jana@example.com", phone: "+420 600 000 000" },
  address: { line1: "Vodickova 12", city: "Prague", zip: "11000", country: "Czechia" },
  item: { productId: "x-nike-pegasus-41", offerId: "x-nike-pegasus-41__s-zalando-cz", title: "Pegasus 41", brand: "Nike", store: "Zalando", domain: "zalando.cz", url: "https://zalando.cz/p", price: 129.95, fromCity: "Berlin" },
  speed: "standard" as const,
};

describe("OrderInput", () => {
  it("accepts a complete order", () => {
    expect(OrderInput.safeParse(base).success).toBe(true);
  });

  it("rejects bad email, missing street, http links and silly prices", () => {
    expect(OrderInput.safeParse({ ...base, customer: { ...base.customer, email: "nope" } }).success).toBe(false);
    expect(OrderInput.safeParse({ ...base, address: { ...base.address, line1: "" } }).success).toBe(false);
    expect(OrderInput.safeParse({ ...base, item: { ...base.item, url: "http://zalando.cz" } }).success).toBe(false);
    expect(OrderInput.safeParse({ ...base, item: { ...base.item, price: 0 } }).success).toBe(false);
    expect(OrderInput.safeParse({ ...base, item: { ...base.item, price: 1e9 } }).success).toBe(false);
  });
});

describe("priceOrder", () => {
  it("adds delivery and a 3% service fee", () => {
    const p = priceOrder(OrderInput.parse(base), 3);
    if ("error" in p) throw new Error(p.error);
    expect(p.delivery.label).toBe("Standard");
    expect(p.fee).toBeCloseTo(((129.95 + p.delivery.price) * 3) / 100, 1);
    expect(p.authorized).toBeCloseTo(129.95 + p.delivery.price + p.fee, 2);
  });

  it("uses the catalog price for built-in products, whatever the browser sent", () => {
    const offer = OFFERS[0];
    const p = priceOrder(OrderInput.parse({ ...base, item: { ...base.item, productId: offer.productId, offerId: offer.id, price: 1 } }), 3);
    if ("error" in p) throw new Error(p.error);
    expect(p.item.price).toBe(Math.round(offer.price * 100) / 100);
  });

  it("refuses unknown cities and delivery options that don't exist", () => {
    expect("error" in priceOrder(OrderInput.parse({ ...base, address: { ...base.address, city: "Atlantis" } }), 3)).toBe(true);
    expect("error" in priceOrder(OrderInput.parse({ ...base, speed: "sameday" }), 3)).toBe(true);
  });
});

describe("helpers", () => {
  it("has a 1 EUR minimum service fee", () => {
    expect(serviceFee(10, 3)).toBe(1);
    expect(serviceFee(200, 3)).toBe(6);
  });

  it("links to the right carrier tracking page", () => {
    expect(carrierTrackingUrl("DHL Express", "123")).toMatch(/dhl\.com/);
    expect(carrierTrackingUrl("Packeta", "Z1")).toMatch(/packeta/);
    expect(carrierTrackingUrl("Unknown Co", "1")).toBeUndefined();
  });
});

describe("shop link protection", () => {
  it("takes the shop for catalog products from the catalog, ignoring what the browser sent", () => {
    const offer = OFFERS[0];
    const p = priceOrder(OrderInput.parse({ ...base, item: { ...base.item, productId: offer.productId, offerId: offer.id, domain: "alza.cz", url: "https://evil.example/alza-lookalike" } }), 3);
    if ("error" in p) throw new Error(p.error);
    expect(p.item.url).toBeUndefined();
    expect(p.item.domain).not.toBe("evil.example");
  });

  it("refuses a product link on a different site than the shop", () => {
    const p = priceOrder(OrderInput.parse({ ...base, item: { ...base.item, url: "https://evil.example/p" } }), 3);
    expect("error" in p && p.error).toMatch(/doesn't match/);
  });

  it("accepts a link on the shop's own site or a subdomain, and normalises the domain", () => {
    const p = priceOrder(OrderInput.parse({ ...base, item: { ...base.item, domain: "https://www.zalando.cz/shoes", url: "https://m.zalando.cz/p/1" } }), 3);
    if ("error" in p) throw new Error(p.error);
    expect(p.item.domain).toBe("zalando.cz");
  });

  it("normaliseDomain rejects junk", () => {
    expect(normalizeDomain("not a domain")).toBe("");
    expect(normalizeDomain("WWW.Shop.CZ/x")).toBe("shop.cz");
  });
});
