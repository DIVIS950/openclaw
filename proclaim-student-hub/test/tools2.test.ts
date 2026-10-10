import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMarking, readQuestions, verdictFor } from "../src/lab/Open.tsx";
import { backups, exportAll, importAll } from "../src/lib/backup.ts";
import {
  fullTitle,
  parseClassroomEmail,
  parseCourse,
  parseTestNotice,
} from "../src/lib/classroomSync.ts";

// Real Classroom emails from the student's inbox (October 2026), backups, exam questions.

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
}

beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

const now = new Date("2026-10-04T09:00:00");

describe("Classroom emails as they really arrive", () => {
  it("reads the class from the notification snippet", () => {
    expect(
      parseCourse(
        "Notification settings Y9 SPANISH-QRS New assignment Y9 2.3b Vocab TEST La comida de mi familia Due Oct 9 See details",
      ),
    ).toBe("Y9 SPANISH-QRS");
    expect(
      parseCourse(
        "Notification settings 9Z Geography New material L3 - Mapping Rivers See details",
      ),
    ).toBe("9Z Geography");
    expect(
      parseCourse(
        "Notification settings Y9 Math 26/27 Mr Example Due tomorrow HW due Thursday 10/1 Complete the packet",
      ),
    ).toBe("Y9 Math 26/27 Mr Example");
  });

  it("recovers a title Gmail cut short", () => {
    expect(
      fullTitle(
        "Y9 2.3b Vocab TEST La comida de…",
        "Notification settings Y9 SPANISH-QRS New assignment Y9 2.3b Vocab TEST La comida de mi familia Due Oct 9 See details Posted on",
      ),
    ).toBe("Y9 2.3b Vocab TEST La comida de mi familia");
    expect(fullTitle("Wordsmith Quest", "whatever")).toBe("Wordsmith Quest");
  });

  it("turns a Spanish vocab test email into homework with its class and due date", () => {
    const task = parseClassroomEmail(
      {
        subject: 'New assignment: "Y9 2.3b Vocab TEST La comida de…"',
        snippet:
          "Notification settings Y9 SPANISH-QRS New assignment Y9 2.3b Vocab TEST La comida de mi familia Due Oct 9 See details Posted on 8:32 AM, Oct 2 (CEST) by Sam Sample",
      },
      now,
    );
    expect(task).toEqual({
      title: "Y9 2.3b Vocab TEST La comida de mi familia",
      due: "2026-10-09",
      course: "Y9 SPANISH-QRS",
    });
  });

  it("skips materials and announcements but spots a test notice with a Czech date", () => {
    const material = {
      subject: 'New material: "Test 6.10. - opakování látky"',
      snippet:
        "Notification settings Y9 Z - Český jazyk 2030/2031 New material Test 6.10. - opakování látky Dobrý den",
    };
    expect(parseClassroomEmail(material, now)).toBeNull();
    expect(parseTestNotice(material, "2026-10-04")).toEqual({
      topic: "Test 6.10. - opakování látky",
      date: "2026-10-06",
      course: "Y9 Z - Český jazyk 2030/2031",
    });
    expect(
      parseTestNotice(
        { subject: 'New material: "L3 - Mapping Rivers"', snippet: "" },
        "2026-10-04",
      ),
    ).toBeNull();
  });
});

describe("automatic saves", () => {
  it("keeps one snapshot a day, at most five, and restores it", () => {
    localStorage.setItem("psh.todos", JSON.stringify([{ id: "a", text: "x" }]));
    localStorage.setItem("psh.ai.key", "sk-ant-secret");
    expect(backups.daily(localStorage, new Date("2026-10-04T08:00:00"))).toBe(true);
    expect(backups.daily(localStorage, new Date("2026-10-04T09:00:00"))).toBe(false);
    for (let d = 5; d <= 10; d++) {
      backups.daily(localStorage, new Date(`2026-10-${String(d).padStart(2, "0")}T08:00:00`));
    }
    expect(backups.list().length).toBe(5);
    expect(backups.list()[0].day).toBe("2026-10-10");
    localStorage.setItem("psh.todos", "[]");
    expect(backups.restore("2026-10-10")).toBe(true);
    expect(JSON.parse(localStorage.getItem("psh.todos")!)).toEqual([{ id: "a", text: "x" }]);
    // The key never goes into a snapshot.
    expect(JSON.stringify(backups.get("2026-10-10"))).not.toContain("sk-ant");
  });

  it("exports and imports, keeping the phone's own items", () => {
    localStorage.setItem("psh.todos", JSON.stringify([{ id: "a", text: "mine", done: true }]));
    const file = exportAll();
    expect(file).not.toContain("psh.ai.key");
    localStorage.setItem(
      "psh.todos",
      JSON.stringify([
        { id: "a", text: "mine", done: false },
        { id: "b", text: "new" },
      ]),
    );
    expect(importAll(file)).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem("psh.todos")!)).toEqual([
      { id: "a", text: "mine", done: false },
      { id: "b", text: "new" },
    ]);
    expect(() => importAll("nope")).toThrow(/isn't a Student Hub backup/);
  });
});

describe("exam questions", () => {
  it("reads questions and marks safely", () => {
    const qs = readQuestions({
      questions: [
        { question: "Why?", modelAnswer: "Because.", points: ["x", 1], marks: 9 },
        { question: "", modelAnswer: "y" },
      ],
    });
    expect(qs).toEqual([{ question: "Why?", modelAnswer: "Because.", points: ["x"], marks: 6 }]);
    expect(readMarking({ score: 7, feedback: " good " }, 3)).toEqual({
      score: 3,
      feedback: "good",
    });
    expect(verdictFor(3, 3)).toBe("correct");
    expect(verdictFor(2, 3)).toBe("almost");
    expect(verdictFor(0, 3)).toBe("wrong");
  });
});

import { calc } from "../src/components/Tools.tsx";

describe("calculator", () => {
  it("does arithmetic and nothing else", () => {
    expect(calc("(3 + 4) × 5")).toBe("35");
    expect(calc("15% × 80")).toBe("12");
    expect(calc("2^10")).toBe("1024");
    expect(calc("7 ÷ 2")).toBe("3.5");
    expect(calc("alert(1)")).toBe("");
    expect(calc("1/0")).toBe("Can't divide by 0");
    expect(calc("10^400")).toBe("");
  });
});

import { newClassroomTasks } from "../src/lib/classroomSync.ts";

describe("due tomorrow", () => {
  it("counts from the day the email was sent, and skips what is already past", () => {
    const emails = [
      {
        id: "e1",
        subject: 'Due tomorrow: "HW due Thursday 10/1"',
        snippet:
          "Notification settings Y9 Math 26/27 Mr Example Due tomorrow HW due Thursday 10/1 Complete the packet Due Oct 1 View assignment",
        sender: "no-reply@classroom.google.com",
        date: "2026-09-30T21:55:16Z",
        viewUrl: "",
        labelIds: [],
      },
      {
        id: "e2",
        subject: 'Due tomorrow: "Read chapter 3"',
        snippet: "Notification settings 9i English Due tomorrow Read chapter 3 View assignment",
        sender: "no-reply@classroom.google.com",
        date: "2026-10-04T18:00:00Z",
        viewUrl: "",
        labelIds: [],
      },
    ];
    const { tasks } = newClassroomTasks(
      emails as never,
      [],
      new Set(),
      new Date("2026-10-04T20:00:00"),
    );
    expect(tasks).toEqual([{ title: "Read chapter 3", due: "2026-10-05", course: "9i English" }]);
  });
});
