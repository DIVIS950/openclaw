import { describe, expect, it, vi } from "vitest";
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
  });

  it("rejects seeds without a version", () => {
    expect(readSeed({ timetable: [] })).toBeNull();
    expect(readSeed(null)).toBeNull();
  });
});

describe("applyLocalSeed", () => {
  it("moves a test to the seed's new date instead of adding a second copy", async () => {
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
    const { prepTests } = await import("../src/lib/study.ts");
    const { schedule } = await import("../src/lib/store.ts");
    const { applyLocalSeed, readSeed } = await import("../src/lib/seed.ts");
    const topic = "Czech Geography: summative test (Europe political map)";
    schedule.save({ tests: [{ topic, date: "2026-10-20" }], days: [], done: [] });
    prepTests.save([
      {
        id: "x1",
        subject: "Czech Geography",
        topic,
        date: "2026-10-20",
        start: "2026-10-01",
        packId: "",
        done: [],
      },
    ]);
    applyLocalSeed(
      readSeed({
        version: "v2",
        timetable: [],
        tests: [{ topic, date: "2026-10-22" }],
        homework: [],
        courses: [],
      }),
    );
    expect(schedule.get().tests).toEqual([{ topic, date: "2026-10-22" }]);
    expect(prepTests.all().map((t) => t.date)).toEqual(["2026-10-22"]);
    vi.unstubAllGlobals();
  });
});
