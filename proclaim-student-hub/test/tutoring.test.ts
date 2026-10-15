import { describe, expect, it } from "vitest";
import { buildDay } from "../src/lib/daySummary.ts";
import type { Tutor } from "../src/lib/study.ts";
import { prepPrompt, readPrep, readRecap, recapPrompt, tutorContext } from "../src/lib/tutorAi.ts";
import {
  lessonLabel,
  nextLesson,
  parseWhen,
  tutoringInDays,
  upcomingTutoring,
} from "../src/lib/tutorSchedule.ts";
import { weekPrompt } from "../src/lib/weekPlan.ts";

const tutor = (when: string, extra: Partial<Tutor> = {}): Tutor => ({
  id: "u1",
  name: "Anna",
  subject: "Maths",
  meet: "",
  whatsapp: "",
  when,
  ...extra,
});

// Tuesday 29 September 2026, 10:00
const NOW = new Date(2026, 8, 29, 10, 0);

describe("reading lesson times", () => {
  it("understands English, Czech and Spanish", () => {
    expect(parseWhen("Tuesdays 17:00")).toEqual({ days: [2], time: "17:00" });
    expect(parseWhen("Mon & Thu 5pm")).toEqual({ days: [1, 4], time: "17:00" });
    expect(parseWhen("po a čt 16.30")).toEqual({ days: [1, 4], time: "16:30" });
    expect(parseWhen("každé úterý v 18:15")).toEqual({ days: [2], time: "18:15" });
    expect(parseWhen("martes 18h")).toEqual({ days: [2], time: "18:00" });
    expect(parseWhen("weekdays 7:30 am")).toEqual({ days: [1, 2, 3, 4, 5], time: "07:30" });
  });

  it("says when it can't tell", () => {
    expect(parseWhen("sometimes")).toBeNull();
    expect(parseWhen("17:00")).toBeNull();
    expect(parseWhen("Tuesday")).toBeNull();
  });
});

describe("next lesson", () => {
  it("finds today's, a later day's, and the one that's on now", () => {
    expect(nextLesson(tutor("Tuesdays 17:00"), NOW)).toEqual(new Date(2026, 8, 29, 17, 0));
    expect(nextLesson(tutor("Thursdays 16:30"), NOW)).toEqual(new Date(2026, 9, 1, 16, 30));
    expect(nextLesson(tutor("Tuesdays 9:30"), NOW)).toEqual(new Date(2026, 8, 29, 9, 30));
    expect(nextLesson(tutor("Tuesdays 8:00"), NOW)).toEqual(new Date(2026, 9, 6, 8, 0));
    expect(nextLesson(tutor("whenever"), NOW)).toBeNull();
  });

  it("labels the countdown", () => {
    expect(lessonLabel(new Date(2026, 8, 29, 9, 30), NOW)).toBe("on now");
    expect(lessonLabel(new Date(2026, 8, 29, 10, 45), NOW)).toBe("in 45 min");
    expect(lessonLabel(new Date(2026, 8, 29, 11, 30), NOW)).toBe("in 1 h 30 min");
    expect(lessonLabel(new Date(2026, 8, 29, 17, 0), NOW)).toBe("today 17:00");
    expect(lessonLabel(new Date(2026, 8, 30, 17, 0), NOW)).toBe("tomorrow 17:00");
    expect(lessonLabel(new Date(2026, 9, 1, 16, 30), NOW)).toBe("Thu 16:30");
  });

  it("sorts tutors and lists a week of lessons", () => {
    const list = upcomingTutoring(
      [tutor("Thu 16:30", { id: "b", name: "Ben" }), tutor("Tue 17:00"), tutor("?", { id: "c" })],
      NOW,
    );
    expect(list.map((u) => u.tutor.id)).toEqual(["u1", "b"]);
    expect(
      tutoringInDays([tutor("Mon & Thu 16:30")], NOW, 7).map((u) => u.start.getDate()),
    ).toEqual([1, 5]);
  });
});

describe("tutoring AI", () => {
  it("gives the AI the tutor's history and open homework", () => {
    const ctx = tutorContext({
      tutor: tutor("Tue 17:00"),
      sessions: [
        { id: "s", tutorId: "u1", date: "2026-09-22", topic: "Fractions", notes: "adding" },
      ],
      materials: [],
      todos: [
        {
          id: "t",
          text: "Worksheet 3",
          done: false,
          due: "",
          subject: "Maths",
          from: "Tutoring with Anna",
        },
        { id: "x", text: "PE kit", done: false, due: "", subject: "", from: "" },
      ],
      schoolWork: ["Test: Quadratics on 2026-10-06"],
    });
    expect(ctx).toContain('"openTutorHomework":["Worksheet 3"]');
    expect(ctx).toContain("Quadratics");
    expect(prepPrompt(ctx)).toContain("<tutoring>");
    expect(recapPrompt(tutor("Tue 17:00"), "we did x")).toContain("<rough>we did x</rough>");
  });

  it("reads the AI's answers safely", () => {
    expect(
      readPrep({ focus: "Quadratics", ask: ["Why?", 3, ""], review: [], bring: ["Worksheet"] }),
    ).toEqual({
      focus: "Quadratics",
      ask: ["Why?"],
      review: [],
      bring: ["Worksheet"],
    });
    expect(readRecap(null)).toEqual({ topic: "", notes: "", homework: [] });
    expect(readRecap({ topic: "Fractions", notes: "• a", homework: ["p. 12", ""] })).toEqual({
      topic: "Fractions",
      notes: "• a",
      homework: ["p. 12"],
    });
  });
});

describe("reminders", () => {
  it("puts a lesson in the next two days into Today's coming up", () => {
    const d = buildDay({
      now: NOW,
      today: "2026-09-29",
      homework: [],
      prep: [],
      tests: [],
      todos: [],
      events: [],
      lessons: [],
      emails: [],
      tutoring: [
        { tutor: tutor("Tue 17:00"), start: new Date(2026, 8, 29, 17, 0), label: "today 17:00" },
        {
          tutor: tutor("Mon 17:00", { id: "far" }),
          start: new Date(2026, 9, 5, 17, 0),
          label: "Mon 17:00",
        },
      ],
    });
    expect(d.coming.map((x) => [x.ref, x.text, x.sub])).toEqual([
      ["tutor:u1", "Maths with Anna", "today 17:00"],
    ]);
  });

  it("tells the week planner when tutoring is", () => {
    const p = weekPrompt(
      {
        homework: [],
        tests: [],
        todos: [],
        events: [],
        lessons: [],
        tutors: [tutor("Thursdays 16:30")],
      },
      "2026-09-29",
    );
    expect(p).toContain('"events":["16:30 Maths tutoring with Anna"]');
  });
});
