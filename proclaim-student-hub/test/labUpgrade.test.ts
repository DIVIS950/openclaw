import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modeBlocked, newItem, type LabPack } from "../src/lab/model.ts";
import { daily, DAILY_GOAL, hearable, speechLang } from "../src/lab/speech.ts";

const TODAY = "2026-09-29";

const pack = (subject: LabPack["subject"], kinds: ("term" | "qa")[]): LabPack => ({
  id: "p",
  subject,
  topic: "t",
  docType: "notes",
  createdAt: "",
  testScore: "",
  insight: "",
  items: kinds.map((kind, i) => newItem({ prompt: `w${i}`, answer: `a${i}`, kind }, TODAY)),
  steps: [],
  gaps: [],
  labels: [],
  photo: "",
});

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("pronunciation", () => {
  it("uses the right voice for language packs only", () => {
    expect(speechLang("Spanish")).toBe("es-ES");
    expect(speechLang("Czech")).toBe("cs-CZ");
    expect(speechLang("Maths")).toBeNull();
  });

  it("only offers listening for vocab words", () => {
    const es = pack("Spanish", ["term", "qa"]);
    expect(hearable(es.items[0], "Spanish")).toBe(true);
    expect(hearable(es.items[1], "Spanish")).toBe(false);
    expect(hearable(es.items[0], "Science")).toBe(false);
  });

  it("blocks Listen & type outside Spanish/Czech vocab", () => {
    expect(modeBlocked("listen", pack("Spanish", ["term", "term"]))).toBeNull();
    expect(modeBlocked("listen", pack("Czech", ["qa"]))).toBe("Only for Spanish or Czech vocab");
    expect(modeBlocked("listen", pack("Science", ["term"]))).toBe(
      "Only for Spanish or Czech vocab",
    );
  });
});

describe("daily goal", () => {
  it("counts cards per day and starts fresh the next day", () => {
    expect(daily.get(TODAY)).toEqual({ date: TODAY, count: 0 });
    daily.add(TODAY, 8);
    expect(daily.add(TODAY, 5).count).toBe(13);
    expect(daily.get("2026-09-30").count).toBe(0);
    expect(DAILY_GOAL).toBeGreaterThan(0);
  });
});
