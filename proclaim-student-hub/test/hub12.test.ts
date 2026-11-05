import { describe, expect, it } from "vitest";
import type { LabPack } from "../src/lab/model.ts";
import type { Lesson } from "../src/lib/aiFeatures.ts";
import { lateHomework, lateLabel } from "../src/lib/format.ts";
import { fold, searchEverything, snippet, type SearchSources } from "../src/lib/search.ts";
import type { Note, PrepTest, Todo } from "../src/lib/study.ts";
import { fingerprint, mergeSync, stableJson, syncable } from "../src/lib/syncMerge.ts";
import type { Homework } from "../src/lib/types.ts";
import { schoolBreak } from "../src/screens/Today.tsx";

const hw = (id: string, title: string, due?: string, done = false, course = "9I Art"): Homework =>
  ({ id, title, course, source: "Classroom", description: "", done, due, link: "" }) as Homework;

const empty: SearchSources = {
  homework: [],
  tests: [],
  notes: [],
  packs: [],
  todos: [],
  lessons: [],
};

describe("search everything", () => {
  it("ignores accents and case", () => {
    expect(fold("Čtenářský DENÍK")).toBe("ctenarsky denik");
    const hits = searchEverything("ctenarsky", {
      ...empty,
      homework: [hw("a", "Čtenářský deník")],
    });
    expect(hits.map((h) => h.title)).toEqual(["Čtenářský deník"]);
  });

  it("needs every word, and ranks a title that starts with it first", () => {
    const src = {
      ...empty,
      homework: [
        hw("1", "Read chapter 3 English"),
        hw("2", "English essay"),
        hw("3", "Maths sheet"),
        hw("4", "Poem", undefined, false, "9I English"),
      ],
    };
    // Title first (starts with, then has it), then a match on the class only.
    expect(searchEverything("english", src).map((h) => h.id)).toEqual(["2", "1", "4"]);
    expect(searchEverything("english essay", src).map((h) => h.id)).toEqual(["2"]);
    expect(searchEverything("   ", src)).toEqual([]);
  });

  it("finds notes, tests, cards, to-dos and lessons, in that group order", () => {
    const note: Note = {
      id: "n1",
      title: "Volcanoes",
      subject: "Geography",
      body: "Magma rises through the crust and erupts as lava.",
      updatedAt: "2026-10-10",
      packId: "",
    };
    const test: PrepTest = {
      id: "t1",
      subject: "Geography",
      topic: "Restless Earth",
      date: "2026-10-20",
      start: "2026-10-10",
      packId: "",
      done: [],
    };
    const pack = {
      id: "p1",
      subject: "Geography",
      topic: "Restless Earth",
      items: [{ id: "c1", prompt: "lava", answer: "magma on the surface" }],
    } as unknown as LabPack;
    const todo: Todo = {
      id: "d1",
      text: "Lava lamp for science",
      done: false,
      due: "",
      subject: "",
      from: "",
    };
    const lesson: Lesson = {
      day: "Mon",
      start: "08:15",
      end: "09:00",
      subject: "Geography",
      room: "R2",
    };
    const hits = searchEverything("lava", {
      ...empty,
      notes: [note],
      tests: [test],
      packs: [pack],
      todos: [todo],
      lessons: [lesson],
    });
    expect(hits.map((h) => h.kind)).toEqual(["note", "card", "todo"]);
    expect(hits.find((h) => h.kind === "card")?.packId).toBe("p1");
    expect(
      searchEverything("geography", { ...empty, tests: [test], lessons: [lesson] }).map(
        (h) => h.kind,
      ),
    ).toEqual(["test", "lesson"]);
  });

  it("shows the part of a note around the match", () => {
    const body = `${"intro ".repeat(30)}the word photosynthesis is here ${"outro ".repeat(30)}`;
    const s = snippet(body, "photosynthesis");
    expect(s).toContain("photosynthesis");
    expect(s.startsWith("…")).toBe(true);
  });
});

describe("late homework", () => {
  const now = new Date(2026, 9, 18, 9);
  it("is open work whose due day has passed, oldest first", () => {
    const list = [
      hw("a", "Due today", new Date(2026, 9, 18, 14).toISOString()),
      hw("b", "Two days ago", new Date(2026, 9, 16, 14).toISOString()),
      hw("c", "Done late", new Date(2026, 9, 10, 14).toISOString(), true),
      hw("d", "Yesterday", new Date(2026, 9, 17, 14).toISOString()),
      hw("e", "No date"),
    ];
    expect(lateHomework(list, now).map((h) => h.id)).toEqual(["b", "d"]);
    expect(lateLabel(new Date(2026, 9, 17, 14).toISOString(), now)).toBe("1 day late");
    expect(lateLabel(new Date(2026, 9, 15, 14).toISOString(), now)).toBe("3 days late");
  });
});

describe("weekend mode", () => {
  const lessons: Lesson[] = [
    { day: "Mon", start: "08:15", end: "09:00", subject: "Geography", room: "" },
    { day: "Tue", start: "08:15", end: "09:00", subject: "English", room: "" },
  ];
  it("looks ahead to the next school day on a day without lessons", () => {
    // Sunday 18 October 2026.
    expect(schoolBreak(lessons, new Date(2026, 9, 18, 10))).toEqual({
      date: "2026-10-19",
      name: "Monday",
    });
    // Wednesday has no lessons in this timetable either: Monday next.
    expect(schoolBreak(lessons, new Date(2026, 9, 21, 10))?.name).toBe("Monday");
  });
  it("is off on a school day, and without a timetable Monday to Friday are school days", () => {
    expect(schoolBreak(lessons, new Date(2026, 9, 19, 10))).toBeNull();
    expect(schoolBreak([], new Date(2026, 9, 16, 10))).toBeNull();
    expect(schoolBreak([], new Date(2026, 9, 17, 10))).toEqual({
      date: "2026-10-19",
      name: "Monday",
    });
  });
});

describe("sync my devices", () => {
  const H = "psh.db/data/users/me/state/homework/";

  it("only moves the student's own data, never keys or tokens", () => {
    expect(syncable("psh.notes")).toBe(true);
    expect(syncable("psh.lab.packs")).toBe(true);
    expect(syncable(`${H}abc`)).toBe(true);
    expect(syncable("psh.ai.key")).toBe(false);
    expect(syncable("psh.token")).toBe(false);
    expect(syncable("psh.google.client")).toBe(false);
    expect(syncable("psh.sync.base")).toBe(false);
    expect(syncable("psh.tour")).toBe(false);
  });

  it("gives the same fingerprint whatever order the keys are in", () => {
    expect(stableJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });

  it("first sync: both devices' data end up on both", () => {
    const local = { "psh.notes": [{ id: "n1", title: "Mine" }] };
    const remote = {
      "psh.notes": [{ id: "n2", title: "From iPad" }],
      [`${H}x`]: { title: "Essay" },
    };
    const r = mergeSync({}, local, remote);
    expect(r.merged["psh.notes"]).toEqual([
      { id: "n1", title: "Mine" },
      { id: "n2", title: "From iPad" },
    ]);
    expect(r.toLocal[`${H}x`]).toEqual({ title: "Essay" });
    expect(r.upload).toBe(true);
  });

  it("takes changes from the other device and sends this device's", () => {
    const base0 = { "psh.todos": [{ id: "t1", done: false }], "psh.notes": [{ id: "n1" }] };
    const base = mergeSync({}, base0, base0).base;
    // The iPad ticked the to-do; this phone added a note.
    const remote = { "psh.todos": [{ id: "t1", done: true }], "psh.notes": [{ id: "n1" }] };
    const local = {
      "psh.todos": [{ id: "t1", done: false }],
      "psh.notes": [{ id: "n1" }, { id: "n2" }],
    };
    const r = mergeSync(base, local, remote);
    expect(r.toLocal).toEqual({ "psh.todos": [{ id: "t1", done: true }] });
    expect(r.merged["psh.notes"]).toEqual([{ id: "n1" }, { id: "n2" }]);
    expect(r.upload).toBe(true);
  });

  it("a deletion on one device reaches the other", () => {
    const both = { [`${H}a`]: { title: "Old" }, "psh.notes": [{ id: "n1" }, { id: "n2" }] };
    const base = mergeSync({}, both, both).base;
    // Deleted here: the task, and one note.
    const r = mergeSync(base, { "psh.notes": [{ id: "n1" }] }, both);
    expect(`${H}a` in r.merged).toBe(false);
    expect(r.merged["psh.notes"]).toEqual([{ id: "n1" }]);
    expect(r.upload).toBe(true);
    // Deleted on the other device: removed here too.
    const r2 = mergeSync(base, both, { "psh.notes": both["psh.notes"] });
    expect(r2.toLocal).toEqual({ [`${H}a`]: undefined });
  });

  it("nothing changed: nothing to write, nothing to send", () => {
    const data = { "psh.progress": { xp: 40, streak: 2 } };
    const base = mergeSync({}, data, data).base;
    const r = mergeSync(base, data, data);
    expect(r.toLocal).toEqual({});
    expect(r.upload).toBe(false);
  });

  it("both changed: XP keeps the higher one and a tick on either device stays", () => {
    const base = mergeSync(
      {},
      { "psh.progress": { xp: 10, streak: 1 }, [`${H}h`]: { title: "T", done: false } },
      { "psh.progress": { xp: 10, streak: 1 }, [`${H}h`]: { title: "T", done: false } },
    ).base;
    const r = mergeSync(
      base,
      { "psh.progress": { xp: 30, streak: 2 }, [`${H}h`]: { title: "T2", done: false } },
      { "psh.progress": { xp: 55, streak: 3 }, [`${H}h`]: { title: "T", done: true } },
    );
    expect(r.merged["psh.progress"]).toEqual({ xp: 55, streak: 3 });
    expect(r.merged[`${H}h`]).toEqual({ title: "T2", done: true });
  });

  it("never brings in keys that aren't the student's data", () => {
    const r = mergeSync({}, {}, { "psh.ai.key": "sk-test", "psh.notes": [] });
    expect("psh.ai.key" in r.toLocal).toBe(false);
    expect("psh.notes" in r.toLocal).toBe(true);
  });
});
