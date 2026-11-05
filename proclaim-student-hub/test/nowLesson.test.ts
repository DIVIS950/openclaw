import { describe, expect, it } from "vitest";
import type { Lesson } from "../src/lib/aiFeatures.ts";
import { nowLesson } from "../src/lib/nowLesson.ts";

const lessons: Lesson[] = [
  { day: "Mon", start: "08:30", end: "09:20", subject: "English", room: "1.2" },
  { day: "Mon", start: "09:20", end: "10:10", subject: "Maths", room: "2.1" },
  { day: "Mon", start: "11:00", end: "", subject: "PE", room: "" },
  { day: "Tue", start: "08:30", end: "09:20", subject: "Czech", room: "" },
];

// 2026-10-05 is a Monday.
const at = (h: number, m: number) => new Date(2026, 9, 5, h, m);

describe("nowLesson", () => {
  it("finds the lesson running now with progress and what comes after", () => {
    const r = nowLesson(lessons, at(8, 55));
    expect(r.state).toBe("now");
    if (r.state === "now") {
      expect(r.lesson.subject).toBe("English");
      expect(r.minutesLeft).toBe(25);
      expect(r.progress).toBeCloseTo(0.5);
      expect(r.after?.subject).toBe("Maths");
    }
  });

  it("shows the next lesson in a gap", () => {
    const r = nowLesson(lessons, at(10, 30));
    expect(r).toMatchObject({ state: "next", minutesUntil: 30 });
  });

  it("treats a lesson with no end as 50 minutes", () => {
    const r = nowLesson(lessons, at(11, 40));
    expect(r).toMatchObject({ state: "now", minutesLeft: 10 });
  });

  it("is empty after the last lesson and on days without lessons", () => {
    expect(nowLesson(lessons, at(15, 0)).state).toBe("none");
    expect(nowLesson(lessons, new Date(2026, 9, 7, 9, 0)).state).toBe("none");
  });
});
