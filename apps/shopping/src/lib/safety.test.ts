import { describe, expect, it } from "vitest";
import { getStore, STORES } from "./data";
import { assessStore } from "./safety";

describe("assessStore", () => {
  it("trusts long-established shops with many reviews", () => {
    const r = assessStore(getStore("alza")!, 240, 249);
    expect(r.level).toBe("safe");
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("flags a brand-new shop selling far below market as a likely scam", () => {
    const r = assessStore(getStore("megadeals")!, 99, 249);
    expect(r.level).toBe("danger");
    expect(r.flags.length).toBeGreaterThan(0);
  });

  it("penalises a suspiciously low price even at a real shop", () => {
    const store = getStore("amazon-de")!;
    expect(assessStore(store, 50, 249).score).toBeLessThan(assessStore(store, 240, 249).score);
  });

  it("keeps every score within 1-99", () => {
    for (const s of STORES) {
      for (const price of [1, 100, 1000]) {
        const { score } = assessStore(s, price, 100);
        expect(score).toBeGreaterThanOrEqual(1);
        expect(score).toBeLessThanOrEqual(99);
      }
    }
  });
});
