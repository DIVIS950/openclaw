import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agenda, upcomingEvents } from "../src/lib/agenda.ts";
import type { AiProvider } from "../src/lib/ai.ts";
import { buildDay, localSummary, readSummary, summaryPrompt } from "../src/lib/daySummary.ts";
import { missing, readSorted, saveSorted, sortPost, sortPrompt } from "../src/lib/sorter.ts";
import { readStartPlan, startPrompt } from "../src/lib/startTask.ts";
import { notes, prepTests, todos } from "../src/lib/study.ts";
import type { Homework } from "../src/lib/types.ts";

const TODAY = "2026-09-29";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Add anything: sorting a post", () => {
  it("tells the AI today's weekday and keeps the post as data", () => {
    const p = sortPrompt("Spanish test Friday", TODAY, ["Y9 Spanish"]);
    expect(p).toContain("Tuesday 2026-09-29");
    expect(p).toContain("Y9 Spanish");
    expect(p).toContain("<post>\nSpanish test Friday\n</post>");
  });

  it("reads the reply safely", () => {
    const items = readSorted({
      items: [
        {
          kind: "test",
          title: "Vocab test U1.1c",
          subject: "Spanish",
          date: "2026-10-02",
          time: "",
        },
        { kind: "weird", title: "Bring PE kit", date: "tomorrow", time: "8:05" },
        { kind: "note", title: "" },
      ],
    });
    expect(items).toEqual([
      {
        kind: "test",
        title: "Vocab test U1.1c",
        subject: "Spanish",
        date: "2026-10-02",
        time: "",
        details: "",
      },
      { kind: "todo", title: "Bring PE kit", subject: "", date: "", time: "08:05", details: "" },
    ]);
    expect(readSorted(null)).toEqual([]);
  });

  it("needs a date for tests and calendar events", () => {
    const base = { title: "x", subject: "", time: "", details: "" };
    expect(missing({ ...base, kind: "test", date: "" }, TODAY)).toBe("Add the date");
    expect(missing({ ...base, kind: "test", date: "2026-09-01" }, TODAY)).toBe(
      "The date has passed",
    );
    expect(missing({ ...base, kind: "event", date: "" }, TODAY)).toBe("Add the date");
    expect(missing({ ...base, kind: "homework", date: "" }, TODAY)).toBe("");
  });

  it("saves each kind in its place", async () => {
    const addHomework = vi.fn(async () => ({}) as Homework);
    const ai = {
      json: vi.fn(async () => ({
        items: [
          { kind: "homework", title: "Worksheet p. 12", subject: "Maths", date: "2026-10-01" },
          { kind: "test", title: "Vocab test", subject: "Spanish", date: "2026-10-02" },
          { kind: "todo", title: "Bring PE kit", date: "2026-09-30" },
          { kind: "event", title: "School trip", date: "2026-10-05", time: "08:00" },
          { kind: "note", title: "Chores", subject: "Spanish", details: "barrer = to sweep" },
          { kind: "test", title: "No date test" },
        ],
      })),
    } as unknown as AiProvider;
    const items = await sortPost(ai, { text: "stuff", images: [], classes: [] }, TODAY);
    const saved = await saveSorted(items, { addHomework }, TODAY);
    expect(saved).toEqual({ homework: 1, test: 1, todo: 1, event: 1, note: 1 });
    expect(addHomework).toHaveBeenCalledWith({
      title: "Worksheet p. 12",
      source: "Other",
      due: "2026-10-01",
      course: "Maths",
    });
    expect(prepTests.all().map((t) => [t.subject, t.topic, t.date])).toEqual([
      ["Spanish", "Vocab test", "2026-10-02"],
    ]);
    expect(todos.all()[0]).toMatchObject({
      text: "Bring PE kit",
      due: "2026-09-30",
      from: "Add anything",
    });
    expect(upcomingEvents(agenda.all(), TODAY).map((e) => [e.title, e.time])).toEqual([
      ["School trip", "08:00"],
    ]);
    expect(notes.all()[0]).toMatchObject({ title: "Chores", body: "barrer = to sweep" });
  });
});

describe("Start it for me", () => {
  it("asks for help starting, not answers", () => {
    const hw = {
      title: "Essay",
      course: "English",
      description: "Write about X",
      due: "2026-10-01T16:00:00Z",
    } as Homework;
    const p = startPrompt(hw, "");
    expect(p).toContain("Do not do it for them");
    expect(p).toContain("due 2026-10-01");
  });

  it("reads the plan safely", () => {
    expect(
      readStartPlan({
        asking: "Compare two poems",
        steps: [
          { step: "Read both", minutes: 2 },
          { step: "", minutes: 9 },
          { step: "Plan", minutes: "x" },
        ],
        outline: "1. Intro [...]",
        check: ["quotes", 3],
      }),
    ).toEqual({
      asking: "Compare two poems",
      steps: [
        { step: "Read both", minutes: 5 },
        { step: "Plan", minutes: 15 },
      ],
      outline: "1. Intro [...]",
      check: ["quotes"],
    });
  });
});

describe("Today summary", () => {
  const hw = (id: string, due: string, done = false): Homework =>
    ({ id, title: `HW ${id}`, course: "Maths", due: `${due}T16:00:00.000Z`, done }) as Homework;
  const day = () =>
    buildDay({
      now: new Date(`${TODAY}T10:15:00`),
      today: TODAY,
      homework: [
        hw("a", "2026-09-30"),
        hw("b", "2026-09-28"),
        hw("c", "2026-10-20"),
        hw("d", "2026-09-30", true),
      ],
      prep: [],
      tests: [
        {
          id: "t",
          subject: "Spanish",
          topic: "Vocab",
          date: "2026-10-02",
          start: TODAY,
          packId: "",
          done: [],
        },
      ],
      todos: [{ id: "x", text: "PE kit", due: TODAY, done: false, subject: "", from: "" }],
      events: [
        { id: "e", title: "Trip", date: "2026-10-01", time: "08:00", subject: "", details: "" },
      ],
      lessons: [
        { day: "Tue", start: "10:00", end: "11:00", subject: "Maths", room: "R6" },
        { day: "Tue", start: "11:15", end: "12:00", subject: "Spanish", room: "" },
      ],
      emails: [
        {
          id: "m",
          kind: "Gmail",
          from: "Office",
          subject: "Trip form",
          snippet: "",
          date: "",
          unread: true,
        },
      ],
    });

  it("gathers the day with the most urgent first", () => {
    const d = day();
    expect(d.now).toBe("Maths (R6) for 45 more min");
    expect(d.next).toBe("Spanish at 11:15");
    expect(d.due.map((x) => [x.id, x.sub])).toEqual([
      ["b", "Maths · overdue since yesterday"],
      ["a", "Maths · due tomorrow"],
    ]);
    expect(d.todos.map((x) => x.id)).toEqual(["x"]);
    expect(d.coming.map((x) => x.ref)).toEqual(["event:e", "test:t"]);
    expect(d.emails.map((x) => x.ref)).toEqual(["email:m"]);
    expect(localSummary(d).focus.map((f) => f.ref)).toEqual(["homework:b", "todo:x", "homework:a"]);
  });

  it("only accepts things that exist from the AI", () => {
    const d = day();
    expect(summaryPrompt(d, "Jan", "Tue Sep 29 2026", 10)).toContain("morning");
    expect(
      readSummary(
        {
          headline: "Finish HW b first.",
          focus: [
            { ref: "homework:b", why: "overdue" },
            { ref: "homework:zzz" },
            { ref: "homework:b" },
          ],
          tip: "Use break",
        },
        d,
      ),
    ).toEqual({
      headline: "Finish HW b first.",
      focus: [{ ref: "homework:b", why: "overdue" }],
      tip: "Use break",
    });
    expect(readSummary({}, d)).toBeNull();
  });
});
