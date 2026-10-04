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
        "Notification settings Y9 SPANISH-ACU New assignment Y9 1.1d Vocab TEST Las habitaciones de mi casa Due Oct 9 See details",
      ),
    ).toBe("Y9 SPANISH-ACU");
    expect(
      parseCourse(
        "Notification settings 9I Geography New material L8 - Measuring Earthquakes See details",
      ),
    ).toBe("9I Geography");
    expect(
      parseCourse(
        "Notification settings Y9 Math 26/27 Mr Fitz Due tomorrow HW due Thursday 10/1 Complete the packet",
      ),
    ).toBe("Y9 Math 26/27 Mr Fitz");
  });

  it("recovers a title Gmail cut short", () => {
    expect(
      fullTitle(
        "Y9 1.1d Vocab TEST Las habitaciones de…",
        "Notification settings Y9 SPANISH-ACU New assignment Y9 1.1d Vocab TEST Las habitaciones de mi casa Due Oct 9 See details Posted on",
      ),
    ).toBe("Y9 1.1d Vocab TEST Las habitaciones de mi casa");
    expect(fullTitle("Bookopoly", "whatever")).toBe("Bookopoly");
  });

  it("turns the Spanish vocab test email into homework with its class and due date", () => {
    const task = parseClassroomEmail(
      {
        subject: 'New assignment: "Y9 1.1d Vocab TEST Las habitaciones de…"',
        snippet:
          "Notification settings Y9 SPANISH-ACU New assignment Y9 1.1d Vocab TEST Las habitaciones de mi casa Due Oct 9 See details Posted on 8:32 AM, Oct 2 (CEST) by Andrea Corongiu",
      },
      now,
    );
    expect(task).toEqual({
      title: "Y9 1.1d Vocab TEST Las habitaciones de mi casa",
      due: "2026-10-09",
      course: "Y9 SPANISH-ACU",
    });
  });

  it("skips materials and announcements but spots a test notice with a Czech date", () => {
    const material = {
      subject: 'New material: "Test 6.10. - organizace výuky"',
      snippet:
        "Notification settings Y9 P - Český jazyk a literatura 2026/2027 New material Test 6.10. - organizace výuky Dobrý den",
    };
    expect(parseClassroomEmail(material, now)).toBeNull();
    expect(parseTestNotice(material, "2026-10-04")).toEqual({
      topic: "Test 6.10. - organizace výuky",
      date: "2026-10-06",
      course: "Y9 P - Český jazyk a literatura 2026/2027",
    });
    expect(
      parseTestNotice(
        { subject: 'New material: "L8 - Measuring Earthquakes"', snippet: "" },
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
    expect(calc("1/0")).toBe("");
  });
});
