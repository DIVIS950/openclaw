import { describe, expect, it } from "vitest";
import { readSeed } from "../src/lib/seed.ts";

describe("readSeed", () => {
  it("keeps valid data and drops the rest", () => {
    const seed = readSeed({
      version: "v1",
      timetable: [
        { day: "Monday", start: "8:15", end: "9:00", subject: "Maths", room: "R1" },
        { day: "Funday", start: "8:15", subject: "Nope" },
      ],
      tests: [
        { topic: "Spanish", date: "2026-10-06" },
        { topic: "Bad date", date: "soon" },
      ],
      homework: [
        { title: "Worksheet 3", course: "Science", due: "2026-10-01" },
        { title: "" },
        { title: "No date", due: "Friday" },
      ],
      courses: [
        {
          name: "Test class",
          subject: "Science",
          posts: [
            { kind: "material", title: "Old", date: "2026-09-01" },
            { kind: "assignment", title: "New", date: "2026-09-20" },
            { kind: "weird", title: "Unknown kind" },
            { title: "" },
          ],
        },
        { name: "" },
      ],
      voiceUrl: "https://evil.example/talk",
    });
    expect(seed?.timetable).toEqual([
      { day: "Mon", start: "08:15", end: "09:00", subject: "Maths", room: "R1" },
    ]);
    expect(seed?.tests).toEqual([{ topic: "Spanish", date: "2026-10-06" }]);
    expect(seed?.homework).toEqual([
      { title: "Worksheet 3", course: "Science", due: "2026-10-01" },
      { title: "No date", course: "", due: undefined },
    ]);
    expect(seed?.courses).toHaveLength(1);
    expect(seed?.courses[0].posts.map((p) => [p.kind, p.title])).toEqual([
      ["assignment", "New"],
      ["material", "Old"],
      ["material", "Unknown kind"],
    ]);
    expect(seed?.voiceUrl).toBe("");
  });

  it("rejects seeds without a version", () => {
    expect(readSeed({ timetable: [] })).toBeNull();
    expect(readSeed(null)).toBeNull();
  });
});
