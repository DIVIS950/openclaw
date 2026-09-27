import { describe, expect, it } from "vitest";
import { quoteDelivery } from "./delivery";
import { findPlace } from "./geo";

const at = (c: string) => findPlace(c)!;

describe("quoteDelivery", () => {
  it("offers same-day courier only when the warehouse is in the same city", () => {
    expect(quoteDelivery(at("Prague"), at("Prague")).some((q) => q.speed === "sameday")).toBe(true);
    expect(quoteDelivery(at("Berlin"), at("Prague")).some((q) => q.speed === "sameday")).toBe(false);
  });

  it("ships intercontinental parcels by air", () => {
    const quotes = quoteDelivery(at("Shenzhen"), at("Prague"));
    expect(quotes.every((q) => q.mode === "air")).toBe(true);
  });

  it("drives short European routes", () => {
    const standard = quoteDelivery(at("Berlin"), at("Prague")).find((q) => q.speed === "standard")!;
    expect(standard.mode).toBe("road");
  });

  it("makes faster options cost more and arrive sooner", () => {
    for (const [a, b] of [["Berlin", "Prague"], ["New York", "Prague"], ["Shenzhen", "Madrid"]]) {
      const q = quoteDelivery(at(a), at(b));
      const economy = q.find((x) => x.speed === "economy")!;
      const express = q.find((x) => x.speed === "express")!;
      expect(express.price).toBeGreaterThan(economy.price);
      expect(express.maxDays).toBeLessThan(economy.maxDays);
    }
  });

  it("never returns an inverted day range", () => {
    for (const q of quoteDelivery(at("Sydney"), at("London"))) expect(q.minDays).toBeLessThanOrEqual(q.maxDays);
  });
});
