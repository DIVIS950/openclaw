import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkInbox } from "../src/lib/linkInbox.ts";
import { todos, tutoring } from "../src/lib/study.ts";
import {
  applyTransfer,
  importable,
  mergeImported,
  packJson,
  transferPreview,
} from "../src/lib/transfer.ts";
import {
  allowedMeet,
  applyReply,
  checkReply,
  emptyUnsent,
  hasUnsent,
  importReplyFromLocation,
  normalizePacket,
  normalizeReply,
  readPacketFromLocation,
  tutorStore,
  unsentStore,
  type TutorReply,
} from "../src/lib/tutorLink.ts";
import { localDb } from "../src/pages/localDb.ts";

// Links from outside (a student's packet, a tutor's reply, an #import=) are
// checked before anything is saved, and the tutor's unsent work survives a reload.

let map: Map<string, string>;
const storage = () => localStorage;

beforeEach(() => {
  map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  });
  linkInbox.clear();
});
afterEach(() => vi.unstubAllGlobals());

/** A fake address bar for the functions that read the #fragment. */
function at(hash: string) {
  const loc = { hash, pathname: "/hub/", search: "" };
  vi.stubGlobal("window", { location: loc });
  vi.stubGlobal("history", {
    replaceState: () => {
      loc.hash = "";
    },
  });
  return loc;
}

const ana = {
  id: "tu1",
  name: "Ana",
  subject: "Spanish",
  meet: "https://meet.google.com/old-link",
  whatsapp: "",
  when: "Tuesdays 17:00",
};

const reply = (over: Partial<TutorReply> = {}): TutorReply => ({
  v: 1,
  kind: "from-tutor",
  tutorId: "tu1",
  tutorName: "Ana",
  sessions: [],
  materials: [],
  homework: [{ id: "t1", text: "Workbook p. 12", due: "2026-10-12", done: false }],
  when: "Tuesdays 17:00",
  meet: "https://meet.google.com/old-link",
  message: "",
  messages: [],
  sentAt: "2026-10-10T10:00:00Z",
  ...over,
});

describe("student packet in the Tutor Hub", () => {
  it("fills missing lists instead of crashing", () => {
    const p = normalizePacket({ v: 1, kind: "to-tutor", student: "Eve", tutor: { id: "t9" } });
    expect(p).not.toBeNull();
    expect(p?.sessions).toEqual([]);
    expect(p?.homework).toEqual([]);
    expect(p?.materials).toEqual([]);
    expect(p?.tutor).toMatchObject({ id: "t9", name: "", when: "", meet: "" });
  });

  it("rejects things that aren't packets and drops bad items", () => {
    expect(normalizePacket(null)).toBeNull();
    expect(normalizePacket({ v: 1, kind: "to-tutor", tutor: {} })).toBeNull();
    expect(normalizePacket({ v: 2, kind: "to-tutor", tutor: { id: "x" } })).toBeNull();
    const p = normalizePacket({
      v: 1,
      kind: "to-tutor",
      tutor: { id: "x" },
      homework: [{ id: "a", text: "ok" }, { id: "b" }, "junk"],
      sessions: "not a list",
    });
    expect(p?.homework.map((h) => h.id)).toEqual(["a"]);
    expect(p?.sessions).toEqual([]);
  });

  it("skips damaged saved copies and other Tutor Hub settings", () => {
    map.set("tutorhub.theme", "dark");
    map.set("tutorhub.bad.eve", JSON.stringify({ v: 1, kind: "to-tutor" }));
    map.set("tutorhub.broken.json", "{");
    map.set(
      "tutorhub.t9.eve",
      JSON.stringify({ v: 1, kind: "to-tutor", student: "Eve", tutor: { id: "t9" } }),
    );
    expect(tutorStore.all().map((p) => p.student)).toEqual(["Eve"]);
    expect(tutorStore.get("t9", "Eve")?.sessions).toEqual([]);
  });

  it("says a cut-short link is damaged", async () => {
    at("#s=garbage");
    await expect(readPacketFromLocation()).resolves.toBe("damaged");
    at("#k=abc");
    await expect(readPacketFromLocation()).resolves.toBeNull();
  });
});

describe("tutor reply allow-list", () => {
  it("is all or nothing", () => {
    expect(normalizeReply(reply())).not.toBeNull();
    expect(normalizeReply({ ...reply(), homework: [{ id: "x" }] })).toBeNull();
    expect(
      normalizeReply({ ...reply(), messages: [{ id: "m", text: "hi", from: "x" }] }),
    ).toBeNull();
    expect(normalizeReply({ ...reply(), tutorId: "" })).toBeNull();
  });

  it("only takes https Meet, Zoom and Teams links", () => {
    expect(allowedMeet("https://meet.google.com/abc-defg-hij")).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
    expect(allowedMeet("https://us02web.zoom.us/j/123")).toBe("https://us02web.zoom.us/j/123");
    expect(allowedMeet("https://teams.microsoft.com/l/meetup-join/x")).not.toBe("");
    expect(allowedMeet("http://meet.google.com/abc")).toBe("");
    expect(allowedMeet("https://evil.example/meet")).toBe("");
    expect(allowedMeet("https://meet.google.com.evil.example/x")).toBe("");
    expect(allowedMeet("https://user@meet.google.com/x")).toBe("");
    expect(allowedMeet("javascript:alert(1)")).toBe("");
  });

  it("refuses a reply from a tutor the student never added", () => {
    tutoring.saveTutors([ana]);
    const r = reply({ tutorId: "stranger", tutorName: "Fake" });
    expect(checkReply(r)).toMatchObject({ kind: "error" });
    expect(applyReply(r, "2026-10-10").homework).toBe(0);
    expect(todos.all()).toHaveLength(0);
  });

  it("shows a new lesson link and time before anything changes", () => {
    tutoring.saveTutors([ana]);
    const r = reply({ meet: "https://meet.google.com/new-link", when: "Fridays 16:00" });
    const check = checkReply(r);
    expect(check.kind).toBe("tutor");
    const lines = check.kind === "tutor" ? check.lines : [];
    expect(lines).toContain("New lesson link: meet.google.com/new-link");
    expect(lines).toContain("New lesson time: Fridays 16:00");
    expect(lines).toContain("Homework: Workbook p. 12");
    // Checking wrote nothing.
    expect(tutoring.tutors()[0].meet).toBe(ana.meet);
    expect(todos.all()).toHaveLength(0);
  });

  it("never swaps the lesson link for another site", () => {
    tutoring.saveTutors([ana]);
    const r = reply({ meet: "https://evil.example/meet" });
    const check = checkReply(r);
    expect(check.kind === "tutor" && check.lines.some((l) => l.includes("left out"))).toBe(true);
    applyReply(r, "2026-10-10");
    expect(tutoring.tutors()[0].meet).toBe(ana.meet);
    expect(todos.all()).toHaveLength(1);
  });

  it("waits in the inbox from the address, and a damaged one says so", async () => {
    tutoring.saveTutors([ana]);
    const loc = at(`#tutor=${await packJson(reply())}`);
    await expect(importReplyFromLocation()).resolves.toBeNull();
    expect(loc.hash).toBe("");
    expect(linkInbox.get()?.kind).toBe("tutor");
    expect(todos.all()).toHaveLength(0);

    at(`#tutor=${await packJson({ ...reply(), homework: [{ id: "x" }] })}`);
    await importReplyFromLocation();
    expect(linkInbox.get()).toMatchObject({
      kind: "error",
      title: "This link couldn't be read",
    });
  });
});

describe("tutor's unsent work", () => {
  const tutor = { when: "Tuesdays 17:00", meet: "" };

  it("is saved per student and comes back after a reload", () => {
    const pile = {
      ...emptyUnsent(),
      sessions: [{ id: "s1", tutorId: "tu1", date: "2026-10-10", topic: "Verbs", notes: "" }],
      homework: [{ id: "h1", text: "Learn 20 verbs", due: "", done: false }],
      message: "See you Tuesday",
    };
    expect(hasUnsent(pile, tutor)).toBe(true);
    unsentStore.set("tu1", "Jan", pile, tutor);
    expect(unsentStore.get("tu1", "jan")).toEqual(pile);
    expect(unsentStore.get("tu1", "Eve")).toEqual(emptyUnsent());
    // Never mistaken for a saved student.
    expect(tutorStore.all()).toEqual([]);
  });

  it("counts an edited lesson time, and is removed once sent", () => {
    expect(hasUnsent({ ...emptyUnsent(), when: "Tuesdays 17:00" }, tutor)).toBe(false);
    expect(hasUnsent({ ...emptyUnsent(), when: "Fridays 16:00" }, tutor)).toBe(true);
    unsentStore.set("tu1", "Jan", { ...emptyUnsent(), when: "Fridays 16:00" }, tutor);
    expect(map.size).toBe(1);
    unsentStore.set("tu1", "Jan", emptyUnsent(), tutor);
    expect(map.size).toBe(0);
    unsentStore.set("tu1", "Jan", { ...emptyUnsent(), message: "hi" }, tutor);
    unsentStore.clear("tu1", "Jan");
    expect(map.size).toBe(0);
  });
});

describe("#import= links", () => {
  it("only write the student's own study data", async () => {
    expect(importable("psh.todos")).toBe(true);
    expect(importable("psh.lab.packs")).toBe(true);
    expect(importable("psh.google.client")).toBe(false);
    expect(importable("psh.ai.key")).toBe(false);
    expect(importable("psh.sync.status")).toBe(false);
    expect(importable("psh.made.up")).toBe(false);
    await applyTransfer(
      {
        v: 1,
        name: "",
        homework: [],
        store: { "psh.google.client": "evil", "psh.todos": [{ id: "t1", text: "PE kit" }] },
      },
      storage(),
      localDb,
    );
    expect(map.has("psh.google.client")).toBe(false);
    expect(JSON.parse(map.get("psh.todos") ?? "[]")).toHaveLength(1);
  });

  it("add to the timetable, classes and plan instead of replacing them", () => {
    const mine = [{ day: 1, start: "08:00", end: "08:45", subject: "Maths", room: "12" }];
    const theirs = [
      { day: 1, start: "08:00", end: "08:45", subject: "Fake", room: "0" },
      { day: 2, start: "09:00", end: "09:45", subject: "Art", room: "3" },
    ];
    expect(mergeImported("psh.timetable", mine, theirs)).toEqual([mine[0], theirs[1]]);
    expect(mergeImported("psh.timetable", [], theirs)).toEqual(theirs);
    const courses = mergeImported(
      "psh.courses",
      [{ name: "Maths", subject: "Maths", posts: [{ kind: "material", title: "A", date: "" }] }],
      [
        { name: "Maths", subject: "X", posts: [{ kind: "material", title: "B", date: "" }] },
        { name: "Art", subject: "Art", posts: [] },
      ],
    ) as { name: string; subject: string; posts: unknown[] }[];
    expect(courses.map((c) => c.name)).toEqual(["Maths", "Art"]);
    expect(courses[0].subject).toBe("Maths");
    expect(courses[0].posts).toHaveLength(2);
    expect(
      mergeImported(
        "psh.schedule",
        { tests: [{ topic: "Maths", date: "2026-10-14" }], days: [], done: ["a"] },
        { tests: [{ topic: "Art", date: "2026-10-20" }], days: [], done: ["a", "b"] },
      ),
    ).toEqual({
      tests: [
        { topic: "Maths", date: "2026-10-14" },
        { topic: "Art", date: "2026-10-20" },
      ],
      days: [],
      done: ["a", "b"],
    });
  });

  it("describe what they bring before asking", () => {
    const lines = transferPreview(
      {
        v: 1,
        name: "Jan",
        homework: [],
        store: { "psh.todos": [{ id: "a" }, { id: "b" }], "psh.ai.key": "x", "psh.theme": "dark" },
      },
      storage(),
    );
    expect(lines).toEqual(["2 to-dos", "1 other setting", "Your name: Jan"]);
  });
});
