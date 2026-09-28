import { describe, expect, it } from "vitest";
import type { Lesson } from "../src/lib/aiFeatures.ts";
import { newClassroomTasks, parseClassroomEmail, parseDue } from "../src/lib/classroomSync.ts";
import { subjectLook } from "../src/lib/subjects.ts";
import { lessonsOn, nowAndNext, schoolDays, weekdayOf } from "../src/lib/timetable.ts";
import type { Email, Homework } from "../src/lib/types.ts";

// Monday 28 September 2026, 10:15
const NOW = new Date(2026, 8, 28, 10, 15);

const email = (
  id: string,
  subject: string,
  snippet = "",
  date = "2026-09-27T10:00:00Z",
): Email => ({
  id,
  kind: "Gmail",
  from: "Honzik",
  subject,
  snippet,
  date,
  unread: true,
});

describe("Classroom emails", () => {
  it("reads work from forwarded and direct notifications", () => {
    expect(
      parseClassroomEmail(
        email("1", 'Fwd: New assignment: "Task 13: Simultaneous equations"'),
        NOW,
      ),
    ).toEqual({
      title: "Task 13: Simultaneous equations",
      due: "",
      course: "",
    });
    expect(parseClassroomEmail(email("2", "Due tomorrow: “Macbeth essay”"), NOW)).toEqual({
      title: "Macbeth essay",
      due: "2026-09-29",
      course: "",
    });
    expect(
      parseClassroomEmail(
        email(
          "3",
          'New question: "Why do plants need light?"',
          "Mr Smith posted a new question in 9A Science. Due Oct 3",
        ),
        NOW,
      ),
    ).toEqual({ title: "Why do plants need light?", due: "2026-10-03", course: "9A Science" });
  });

  it("skips posts that aren't work", () => {
    expect(parseClassroomEmail(email("1", 'Fwd: New material: "Slides"'), NOW)).toBeNull();
    expect(parseClassroomEmail(email("2", "New announcement in 9A Maths"), NOW)).toBeNull();
    expect(parseClassroomEmail(email("3", "Private comment on Task 13"), NOW)).toBeNull();
  });

  it("reads due dates in UK and US order", () => {
    expect(parseDue("Due 3 Oct", NOW)).toBe("2026-10-03");
    expect(parseDue("Due: Friday, 2nd October 2026", NOW)).toBe("2026-10-02");
    expect(parseDue("Due Oct 5, 2026", NOW)).toBe("2026-10-05");
    expect(parseDue("Due today", NOW)).toBe("2026-09-28");
    expect(parseDue("Due 5 Jan", new Date(2026, 11, 10))).toBe("2027-01-05");
    expect(parseDue("no date here", NOW)).toBe("");
  });

  it("adds each task once and skips old or known ones", () => {
    const known = [{ title: "Macbeth essay" } as Homework];
    const emails = [
      email("a", 'New assignment: "Task 13"'),
      email("b", 'Due tomorrow: "Task 13"', "", "2026-09-28T07:00:00Z"),
      email("c", 'New assignment: "Macbeth essay"'),
      email("d", 'Missing assignment: "Old worksheet"', "Due 1 Sep"),
      email("e", 'New assignment: "Already seen"'),
    ];
    const { tasks, ids } = newClassroomTasks(emails, known, new Set(["e"]), NOW);
    expect(tasks).toEqual([{ title: "Task 13", due: "", course: "" }]);
    expect(ids.toSorted()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("subject colours", () => {
  it("matches common subject names", () => {
    expect(subjectLook("Maths").emoji).toBe("📐");
    expect(subjectLook("9A Mathematics").emoji).toBe("📐");
    expect(subjectLook("Spanish").emoji).toBe("💃");
    expect(subjectLook("Art History").emoji).toBe("🖼️");
    expect(subjectLook("Art").emoji).toBe("🎨");
    expect(subjectLook("Physics").emoji).toBe("⚡");
    expect(subjectLook("Physical Education").emoji).toBe("⚽");
    expect(subjectLook("PE").emoji).toBe("⚽");
    expect(subjectLook("English Literature").emoji).toBe("📚");
  });

  it("gives unknown subjects a stable colour", () => {
    expect(subjectLook("Latin")).toEqual(subjectLook("Latin"));
  });
});

describe("timetable", () => {
  const lessons: Lesson[] = [
    { day: "Mon", start: "11:00", end: "12:00", subject: "Science", room: "S1" },
    { day: "Mon", start: "09:50", end: "10:50", subject: "Maths", room: "M2" },
    { day: "Tue", start: "09:00", end: "10:00", subject: "Spanish", room: "" },
    { day: "Sat", start: "09:00", end: "10:00", subject: "Sport", room: "" },
  ];

  it("sorts a day and lists school days", () => {
    expect(lessonsOn(lessons, "Mon").map((l) => l.subject)).toEqual(["Maths", "Science"]);
    expect(schoolDays(lessons)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(weekdayOf(NOW)).toBe("Mon");
  });

  it("knows what's on now and next", () => {
    const r = nowAndNext(lessons, NOW);
    expect(r.current?.subject).toBe("Maths");
    expect(r.left).toBe(35);
    expect(r.next?.subject).toBe("Science");
    expect(r.until).toBe(45);
    const after = nowAndNext(lessons, new Date(2026, 8, 28, 15, 0));
    expect(after.current).toBeNull();
    expect(after.next).toBeNull();
  });
});
