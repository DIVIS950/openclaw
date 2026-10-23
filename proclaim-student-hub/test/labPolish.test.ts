import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sound } from "../src/lab/fx.ts";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("lab sounds", () => {
  it("are on by default and remember the switch", () => {
    expect(sound.on()).toBe(true);
    sound.set(false);
    expect(sound.on()).toBe(false);
    sound.set(true);
    expect(sound.on()).toBe(true);
  });
});
