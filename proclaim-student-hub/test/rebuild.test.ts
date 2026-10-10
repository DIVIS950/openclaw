import { describe, expect, it } from "vitest";
import { mmss } from "../src/components/FocusTimer.tsx";
import { groupByDue } from "../src/lib/format.ts";
import { readSeed, seedTasks } from "../src/lib/seed.ts";
import { dateInTitle } from "../src/lib/study.ts";
import { readWeek, weekPrompt } from "../src/lib/weekPlan.ts";

const TODAY = "2026-09-29";

describe("all class assignments become homework", () => {
  const seed = readSeed({
    version: "t1",
    timetable: [],
    tests: [],
    homework: [
      { title: "Maths homework (due Thursday 1 Oct)", course: "Y9 Maths", due: "2026-10-01" },
    ],
    courses: [
      {
        name: "Y9 Algebra 26/27",
        posts: [
          { kind: "assignment", title: "HW due Thursday 10/1", date: "2026-09-23" },
          { kind: "assignment", title: "Homework due Thursday 9/24", date: "2026-09-17" },
          { kind: "material", title: "Class notes", date: "2026-09-18" },
        ],
      },
      {
        name: "9z English",
        posts: [
          { kind: "assignment", title: "Story Contest", date: "2026-09-25" },
          { kind: "assignment", title: "Science Reporter", date: "2026-09-10" },
        ],
      },
    ],
  })!;

  it("adds each assignment once, ticking off old ones", () => {
    expect(seedTasks(seed, TODAY).map((t) => [t.title, t.due ?? "", t.done])).toEqual([
      ["Maths homework (due Thursday 1 Oct)", "2026-10-01", false],
      ["Homework due Thursday 9/24", "2026-09-24", true],
      ["Story Contest", "", false],
      ["Science Reporter", "", true],
    ]);
  });

  it("reads month names in titles", () => {
    expect(dateInTitle("HW due September 15th", "2026-09-08")).toBe("2026-09-15");
    expect(dateInTitle("Essay by 2 October", TODAY)).toBe("2026-10-02");
    expect(dateInTitle("Group Presentations: Rivers and Rain", TODAY)).toBe("");
  });
});

describe("homework screen groups", () => {
  it("groups by how soon it's due", () => {
    const now = new Date(`${TODAY}T10:00:00`);
    const g = groupByDue(
      [
        { id: "a", due: "2026-10-20T16:00:00" },
        { id: "b", due: "2026-09-27T16:00:00" },
        { id: "c" },
        { id: "d", due: "2026-10-01T16:00:00" },
      ],
      now,
    );
    expect([g.overdue, g.week, g.later, g.noDate].map((x) => x.map((h) => h.id))).toEqual([
      ["b"],
      ["d"],
      ["a"],
      ["c"],
    ]);
  });
});

describe("plan my week", () => {
  it("gives the AI school end times and events", () => {
    const p = weekPrompt(
      {
        homework: [],
        tests: [],
        todos: [],
        events: [
          { id: "e", title: "Trip", date: "2026-10-03", time: "07:45", subject: "", details: "" },
        ],
        lessons: [
          { day: "Tue", start: "13:45", end: "15:15", subject: "Science", room: "" },
          { day: "Tue", start: "08:15", end: "09:00", subject: "Czech", room: "" },
        ],
      },
      TODAY,
    );
    expect(p).toContain('"date":"2026-09-29","weekday":"Tue","schoolEnds":"15:15"');
    expect(p).toContain('"events":["07:45 Trip"]');
  });

  it("keeps only the next seven days, once each, in order", () => {
    expect(
      readWeek(
        {
          days: [
            {
              date: "2026-10-01",
              items: [{ title: "Maths Q1-4", minutes: 400, subject: "Maths" }],
              note: "Busy",
            },
            { date: "2026-09-29", items: [{ title: "" }, { title: "Vocab" }] },
            { date: "2026-09-29", items: [] },
            { date: "2026-10-20", items: [{ title: "Too far" }] },
          ],
        },
        TODAY,
      ),
    ).toEqual([
      { date: "2026-09-29", items: [{ title: "Vocab", minutes: 30, subject: "" }], note: "" },
      {
        date: "2026-10-01",
        items: [{ title: "Maths Q1-4", minutes: 180, subject: "Maths" }],
        note: "Busy",
      },
    ]);
  });
});

describe("focus timer", () => {
  it("shows minutes and seconds", () => {
    expect(mmss(25 * 60)).toBe("25:00");
    expect(mmss(61.2)).toBe("1:02");
    expect(mmss(-3)).toBe("0:00");
  });
});
