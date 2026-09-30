import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODE_PROMPTS } from "../shared/prompts.ts";
import { modeBlocked, MODES, type LabPack } from "../src/lab/model.ts";
import { bySubject, grades, letter, parseScore, percent } from "../src/lib/grades.ts";
import { weekLog } from "../src/lib/store.ts";
import { readReport, weekStart, weekStats } from "../src/lib/weekly.ts";

// Phase 2: grades, weekly report numbers, exam and say-it modes, "like I'm 10".

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("grades", () => {
  it("reads marks written the way students write them", () => {
    expect(parseScore("18/20")).toEqual({ score: 18, outOf: 20 });
    expect(parseScore("18 out of 20")).toEqual({ score: 18, outOf: 20 });
    expect(parseScore("85%")).toEqual({ score: 85, outOf: 100 });
    expect(parseScore("great")).toBeNull();
  });

  it("turns percentages into letters", () => {
    expect(letter(95)).toBe("A*");
    expect(letter(72)).toBe("B");
    expect(letter(30)).toBe("E");
    expect(percent({ score: 18, outOf: 20 })).toBe(90);
  });

  it("averages per subject, weakest first, with a trend", () => {
    grades.add({
      subject: "Maths",
      topic: "a",
      date: "2026-09-01",
      score: 10,
      outOf: 20,
      testId: "",
    });
    grades.add({
      subject: "Maths",
      topic: "b",
      date: "2026-09-20",
      score: 18,
      outOf: 20,
      testId: "",
    });
    grades.add({
      subject: "Science",
      topic: "c",
      date: "2026-09-10",
      score: 19,
      outOf: 20,
      testId: "",
    });
    const s = bySubject(grades.all());
    expect(s.map((x) => x.subject)).toEqual(["Maths", "Science"]);
    expect(s[0]).toMatchObject({ average: 70, count: 2, trend: "up" });
  });

  it("replaces the grade for the same test instead of doubling it", () => {
    grades.add({
      subject: "Maths",
      topic: "a",
      date: "2026-09-01",
      score: 10,
      outOf: 20,
      testId: "x1",
    });
    grades.add({
      subject: "Maths",
      topic: "a",
      date: "2026-09-01",
      score: 15,
      outOf: 20,
      testId: "x1",
    });
    expect(grades.all()).toHaveLength(1);
    expect(grades.all()[0].score).toBe(15);
  });
});

describe("weekly report", () => {
  it("finds the Monday of the week", () => {
    expect(weekStart("2026-09-30")).toBe("2026-09-28"); // Wednesday
    expect(weekStart("2026-09-28")).toBe("2026-09-28"); // Monday
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // Sunday
  });

  it("adds up this week's log and remembers last week's XP", () => {
    weekLog.add("xp", 20, "2026-09-28");
    weekLog.add("xp", 15, "2026-09-30");
    weekLog.add("hw", 1, "2026-09-30");
    weekLog.add("lab", 12, "2026-09-29");
    weekLog.add("xp", 50, "2026-09-25"); // last week
    const s = weekStats(weekLog.all(), "2026-09-30");
    expect(s).toMatchObject({ xp: 35, homework: 1, cards: 12, activeDays: 3, lastXp: 50 });
  });

  it("merges the same day and kind into one counter", () => {
    weekLog.add("hw", 1, "2026-09-30");
    weekLog.add("hw", 1, "2026-09-30");
    expect(weekLog.all()).toEqual([{ day: "2026-09-30", kind: "hw", n: 2 }]);
  });

  it("only accepts a report with a headline", () => {
    expect(readReport({ wins: ["x"] })).toBeNull();
    expect(readReport({ headline: "Good week", wins: ["a", 1], next: "no" })).toEqual({
      headline: "Good week",
      wins: ["a"],
      next: [],
    });
  });
});

describe("lab modes", () => {
  const pack = (subject: LabPack["subject"], n: number): LabPack => ({
    id: "p",
    subject,
    topic: "t",
    docType: "notes",
    createdAt: "",
    testScore: "",
    insight: "",
    items: Array.from({ length: n }, (_, i) => ({
      id: `i${i}`,
      prompt: `w${i}`,
      answer: `m${i}`,
      kind: "term" as const,
      origin: "ai" as const,
      markedWrong: false,
      studentAnswer: "",
      explanation: "",
      box: 0,
      due: "2026-01-01",
      right: 0,
      wrong: 0,
    })),
    steps: [],
    gaps: [],
    labels: [],
    photo: "",
  });

  it("offers exam mode and say it", () => {
    expect(MODES.map((m) => m.id)).toContain("exam");
    expect(MODES.map((m) => m.id)).toContain("speak");
    expect(modeBlocked("exam", pack("Maths", 5))).toBeNull();
    expect(modeBlocked("exam", pack("Maths", 2))).toMatch(/at least 3/);
    expect(modeBlocked("speak", pack("Spanish", 5))).toBeNull();
    expect(modeBlocked("speak", pack("Maths", 5))).toMatch(/Spanish or Czech/);
  });
});

describe("explain like I'm 10", () => {
  it("has its own tutor instructions", () => {
    expect(MODE_PROMPTS.eli10).toMatch(/10 years old/);
  });
});
