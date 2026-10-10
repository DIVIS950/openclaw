import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { progress, todoXp } from "../src/lib/store.ts";
import { callName, joinLabel } from "../src/lib/study.ts";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("to-do XP", () => {
  it("is awarded once per to-do, however often it's ticked", () => {
    const start = progress.get().xp;
    expect(todoXp.tick("t1")).toBe(true);
    expect(todoXp.tick("t1")).toBe(false);
    expect(todoXp.tick("t2")).toBe(true);
    expect(progress.get().xp - start).toBe(4);
  });
});

describe("lesson link label", () => {
  it("names the call by its host", () => {
    expect(joinLabel("https://meet.google.com/abc-defg-hij")).toBe("Join Meet");
    expect(joinLabel("https://us02web.zoom.us/j/123")).toBe("Join Zoom");
    expect(joinLabel("https://teams.microsoft.com/l/meetup-join/x")).toBe("Join Teams");
    expect(joinLabel("https://example.com/call")).toBe("Join call");
  });
  it("is not fooled by a look-alike host", () => {
    expect(callName("https://meet.google.com.evil.example/x")).toBe("the call");
    expect(callName("https://notzoom.us/j/1")).toBe("the call");
  });
});
