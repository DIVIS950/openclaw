import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lesson } from "../src/lib/aiFeatures.ts";
import { requestMessage } from "../src/lib/appChanges.ts";
import { badgeStates, levelTitle, newBadges } from "../src/lib/badges.ts";
import { bagDay, bringPhrase, buildBag } from "../src/lib/bag.ts";
import { buildEvening, DEFAULT_SETTINGS, eveningTasks, hhmm, toMin } from "../src/lib/evening.ts";
import { level, progress, totals, weekLog } from "../src/lib/store.ts";
import type { Homework } from "../src/lib/types.ts";

const lessons: Lesson[] = [
  { day: "Thu", start: "08:00", end: "09:00", subject: "Y9 PE", room: "Gym" },
  { day: "Thu", start: "09:00", end: "10:00", subject: "Y9i Music", room: "M1" },
  { day: "Mon", start: "08:00", end: "09:00", subject: "Y9 Math 26/27", room: "R6" },
];

const hw = (id: string, title: string, due?: string, done = false): Homework =>
  ({ id, title, course: "9I Computer Science 26-27", source: "Classroom", done, due }) as Homework;

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("levels", () => {
  it("grows: 50, 200, 450 XP for levels 2, 3, 4", () => {
    expect(level(0)).toEqual({ level: 1, percent: 0, next: 50 });
    expect(level(50).level).toBe(2);
    expect(level(199).level).toBe(2);
    expect(level(200).level).toBe(3);
    expect(level(125)).toEqual({ level: 2, percent: 50, next: 75 });
    expect(levelTitle(1)).toBe("Rookie");
    expect(levelTitle(5)).toBe("Scholar");
  });
});

describe("totals and badges", () => {
  it("counts all-time totals and keeps the best streak", () => {
    weekLog.add("hw", 1);
    weekLog.add("hw", 2);
    progress.add(5);
    expect(totals.get().hw).toBe(3);
    expect(totals.get().best).toBe(1);
    weekLog.take("hw", 1);
    expect(totals.get().hw).toBe(2);
  });

  it("announces a badge once, but not the ones earned before the feature", () => {
    weekLog.add("hw", 1);
    // First check: records quietly.
    expect(newBadges("2026-10-14")).toEqual([]);
    weekLog.add("hw", 9);
    const fresh = newBadges("2026-10-14").map((b) => b.id);
    expect(fresh).toContain("hw10");
    expect(newBadges("2026-10-14")).toEqual([]);
    expect(badgeStates().find((s) => s.badge.id === "hw10")?.earned).toBe(true);
  });
});

describe("pack my bag", () => {
  it("packs for the next school day, skipping days with no lessons", () => {
    // Wednesday → Thursday; Thursday → next Monday (Fri has no lessons here).
    expect(bagDay(lessons, new Date("2026-10-14T18:00:00")).day).toBe("Thu");
    expect(bagDay(lessons, new Date("2026-10-15T18:00:00")).day).toBe("Mon");
  });

  it("reads teachers' 'bring' notes", () => {
    expect(bringPhrase("For todays class please also bring your computers.")).toBe(
      "your computers",
    );
    expect(bringPhrase("Nothing to see")).toBeNull();
  });

  it("lists lesson kit, hand-ins, tests, notes and basics", () => {
    const bag = buildBag({
      lessons,
      homework: [
        hw("h1", "DNS worksheet", "2026-10-15T14:00:00.000Z"),
        hw("h2", "Old", "2026-10-15T14:00:00.000Z", true),
      ],
      tests: [
        {
          id: "t1",
          subject: "Spanish",
          topic: "Vocab",
          date: "2026-10-15",
          start: "2026-10-10",
          packId: "",
          done: [],
        },
      ],
      emails: [
        {
          id: "e1",
          kind: "Classroom",
          from: "Classroom",
          subject: "New announcement: Music",
          snippet: "Please bring your headphones tomorrow",
          date: "2026-10-14T08:00:00Z",
          unread: true,
        },
      ],
      mine: { "every day": ["Lunch card"] },
      now: new Date("2026-10-14T18:00:00"),
    });
    const texts = bag.items.map((i) => i.text);
    expect(bag.day).toBe("Thu");
    expect(texts).toContain("PE kit");
    expect(texts).toContain("Laptop (Music)");
    expect(texts).toContain("Hand in: DNS worksheet");
    expect(texts).not.toContain("Hand in: Old");
    expect(texts).toContain("Revision notes for Spanish test");
    expect(texts).toContain("Bring your headphones");
    expect(texts).toContain("Lunch card");
    expect(texts).toContain("Pencil case");
    // No duplicates.
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe("plan my evening", () => {
  const base = {
    tests: [],
    todos: [],
    labDue: 0,
    tutoring: [] as { start: Date; name: string; subject: string }[],
    settings: DEFAULT_SETTINGS,
  };

  it("converts times", () => {
    expect(toMin("18:30")).toBe(1110);
    expect(hhmm(1110)).toBe("18:30");
  });

  it("puts urgent homework first and skips done homework", () => {
    const tasks = eveningTasks({
      ...base,
      now: new Date("2026-10-14T16:00:00"),
      homework: [
        hw("later", "Later", "2026-10-19T14:00:00.000Z"),
        hw("soon", "Soon", "2026-10-15T14:00:00.000Z"),
        hw("done", "Done", "2026-10-15T14:00:00.000Z", true),
      ],
    });
    expect(tasks.map((t) => t.ref)).toEqual(["soon", "later"]);
  });

  it("works around dinner and tutoring, with breaks, and lists what doesn't fit", () => {
    const { blocks, leftOver } = buildEvening({
      ...base,
      now: new Date("2026-10-14T16:00:00"),
      homework: Array.from({ length: 8 }, (_, i) =>
        hw(`h${i}`, `HW ${i}`, "2026-10-15T14:00:00.000Z"),
      ),
      tutoring: [{ start: new Date("2026-10-14T17:00:00"), name: "Ana", subject: "Spanish" }],
    });
    const dinner = blocks.find((b) => b.kind === "dinner");
    const tutor = blocks.find((b) => b.kind === "tutor");
    expect(dinner?.start).toBe(toMin("18:30"));
    expect(tutor?.start).toBe(toMin("17:00"));
    // Nothing overlaps.
    const sorted = blocks.toSorted((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].start + sorted[i - 1].mins);
    }
    expect(blocks.some((b) => b.kind === "break")).toBe(true);
    expect(blocks.every((b) => b.start + b.mins <= toMin("21:00"))).toBe(true);
    expect(leftOver.length).toBeGreaterThan(0);
  });
});

describe("change the app", () => {
  it("writes a clear request for Claude", () => {
    const msg = requestMessage("abc", "  Add a lunch menu  ");
    expect(msg).toContain("request abc");
    expect(msg).toContain("Add a lunch menu");
    expect(msg.length).toBeLessThan(4096);
    expect(requestMessage("x", "y".repeat(5000)).length).toBeLessThan(4096);
  });
});
