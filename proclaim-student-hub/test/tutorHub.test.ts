import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todos, tutoring } from "../src/lib/study.ts";
import {
  applyReply,
  appliedSummary,
  buildPacket,
  mergePacket,
  tutorHomework,
  type TutorPacket,
  type TutorReply,
} from "../src/lib/tutorLink.ts";

// The student ↔ tutor exchange: packets out, replies merged in, no duplicates.

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

const ana = {
  id: "tu1",
  name: "Ana",
  subject: "Spanish",
  meet: "",
  whatsapp: "",
  when: "Tuesdays 17:00",
};

describe("packet to the tutor", () => {
  it("carries this tutor's lessons, materials (no photos) and homework", () => {
    tutoring.saveTutors([ana]);
    tutoring.saveSessions([
      { id: "s1", tutorId: "tu1", date: "2026-10-01", topic: "Past tense", notes: "ok" },
      { id: "s2", tutorId: "other", date: "2026-10-01", topic: "Not hers", notes: "" },
    ]);
    tutoring.saveMaterials([
      {
        id: "m1",
        tutorId: "tu1",
        title: "Verbs",
        text: "ser, estar",
        photo: "data:x",
        date: "2026-10-01",
      },
    ]);
    todos.add({
      text: "Learn verbs",
      due: "2026-10-07",
      subject: "Spanish",
      from: "Tutoring with Ana",
    });
    todos.add({ text: "PE kit", due: "", subject: "", from: "" });
    const p = buildPacket(ana, { student: "Jan", mastery: 60, nextTest: null });
    expect(p.sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(p.materials[0]).not.toHaveProperty("photo");
    expect(p.homework.map((h) => h.text)).toEqual(["Learn verbs"]);
    expect(tutorHomework(ana)).toHaveLength(1);
  });
});

describe("reply from the tutor", () => {
  const reply = (over: Partial<TutorReply> = {}): TutorReply => ({
    v: 1,
    kind: "from-tutor",
    tutorId: "tu1",
    tutorName: "Ana",
    sessions: [
      { id: "s9", tutorId: "tu1", date: "2026-10-03", topic: "Subjunctive", notes: "Good" },
    ],
    materials: [{ id: "m9", tutorId: "tu1", title: "List 5", text: "a, b", date: "2026-10-03" }],
    homework: [{ id: "t9", text: "Workbook p. 12", due: "2026-10-10", done: false }],
    when: "Thursdays 16:00",
    meet: "https://meet.google.com/abc",
    message: "Well done today",
    sentAt: "2026-10-03T17:00:00Z",
    ...over,
  });

  it("adds lessons, materials and homework, and updates the lesson time", () => {
    tutoring.saveTutors([ana]);
    const a = applyReply(reply(), "2026-10-03");
    expect(a).toMatchObject({ tutorName: "Ana", sessions: 1, materials: 1, homework: 1 });
    expect(tutoring.sessions()[0].topic).toBe("Subjunctive");
    expect(tutoring.materials()[0]).toMatchObject({ title: "List 5", photo: "" });
    expect(todos.all()[0]).toMatchObject({
      text: "Workbook p. 12",
      from: "Tutoring with Ana",
      subject: "Spanish",
    });
    expect(tutoring.tutors()[0]).toMatchObject({
      when: "Thursdays 16:00",
      meet: "https://meet.google.com/abc",
    });
    expect(appliedSummary(a)).toBe(
      'From Ana: 1 homework, 1 lesson note, 1 material. "Well done today"',
    );
  });

  it("does not add the same things twice", () => {
    tutoring.saveTutors([ana]);
    applyReply(reply(), "2026-10-03");
    const again = applyReply(reply(), "2026-10-03");
    expect(again).toMatchObject({ sessions: 0, materials: 0, homework: 0 });
    expect(todos.all()).toHaveLength(1);
    expect(appliedSummary({ ...again, message: "" })).toBe("From Ana: nothing new.");
  });
});

describe("tutor's saved copy", () => {
  it("keeps what the tutor added when a fresh packet arrives", () => {
    const base = buildPacket(ana, { student: "Jan", mastery: null, nextTest: null });
    const saved: TutorPacket = {
      ...base,
      sessions: [{ id: "s1", tutorId: "tu1", date: "2026-10-01", topic: "Old", notes: "" }],
      homework: [{ id: "t1", text: "Old hw", due: "", done: false }],
    };
    const fresh: TutorPacket = {
      ...base,
      sessions: [],
      homework: [{ id: "t1", text: "Old hw", due: "", done: true }],
    };
    const merged = mergePacket(saved, fresh);
    expect(merged.sessions).toHaveLength(1);
    // The student's done flag wins.
    expect(merged.homework).toEqual([{ id: "t1", text: "Old hw", due: "", done: true }]);
  });
});
