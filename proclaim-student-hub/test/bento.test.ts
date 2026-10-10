import { describe, expect, it } from "vitest";
import type { Lesson } from "../src/lib/aiFeatures.ts";
import { deckBrief, findGammaLink } from "../src/lib/gamma.ts";
import { dueReminders, newHomeworkReminder, NOTIFY_DEFAULTS } from "../src/lib/notify.ts";
import { subjectTone } from "../src/lib/subjects.ts";
import type { Homework } from "../src/lib/types.ts";

const hw = (id: string, due: string, extra: Partial<Homework> = {}): Homework =>
  ({
    id,
    title: `Task ${id}`,
    course: "Maths",
    source: "Classroom",
    due,
    done: false,
    ...extra,
  }) as Homework;

const lessons: Lesson[] = [
  { day: "Mon", start: "09:45", end: "10:30", subject: "Maths", room: "2.14" } as Lesson,
];

describe("reminders", () => {
  it("warns 5 minutes before a lesson, with the room", () => {
    const now = new Date("2026-10-12T09:41:00");
    const out = dueReminders(now, NOTIFY_DEFAULTS, { homework: [], lessons, tutoring: [] });
    expect(out.map((r) => r.id)).toContain("lesson:2026-10-12:09:45");
    expect(out.find((r) => r.id.startsWith("lesson"))?.body).toContain("Room 2.14");
  });

  it("says what is due tomorrow in the evening only", () => {
    const list = [hw("a", "2026-10-13T16:00:00"), hw("b", "2026-10-13T16:00:00", { done: true })];
    const evening = dueReminders(new Date("2026-10-12T19:05:00"), NOTIFY_DEFAULTS, {
      homework: list,
      lessons: [],
      tutoring: [],
    });
    expect(evening.map((r) => r.id)).toEqual(["due:a:2026-10-13"]);
    const noon = dueReminders(new Date("2026-10-12T12:00:00"), NOTIFY_DEFAULTS, {
      homework: list,
      lessons: [],
      tutoring: [],
    });
    expect(noon.filter((r) => r.id.startsWith("due"))).toEqual([]);
  });

  it("stays quiet after 21:30 when quiet hours are on, and respects switches", () => {
    const late = new Date("2026-10-12T22:00:00");
    const start = new Date("2026-10-12T22:10:00");
    const input = { homework: [], lessons: [], tutoring: [{ name: "Ana", start }] };
    expect(dueReminders(late, { ...NOTIFY_DEFAULTS, quiet: true }, input)).toEqual([]);
    expect(dueReminders(late, NOTIFY_DEFAULTS, input).map((r) => r.title)).toEqual([
      "Tutoring in 10 min",
    ]);
    expect(dueReminders(late, { ...NOTIFY_DEFAULTS, tutor: false }, input)).toEqual([]);
  });

  it("sends one morning brief on school days", () => {
    const mon = dueReminders(new Date("2026-10-12T07:30:00"), NOTIFY_DEFAULTS, {
      homework: [hw("a", "2026-10-12T16:00:00")],
      lessons: [],
      tutoring: [],
    });
    expect(mon.find((r) => r.id === "brief:2026-10-12")?.body).toContain("Task a");
    const sat = dueReminders(new Date("2026-10-10T07:30:00"), NOTIFY_DEFAULTS, {
      homework: [],
      lessons: [],
      tutoring: [],
    });
    expect(sat).toEqual([]);
  });

  it("groups new homework into one alert", () => {
    expect(newHomeworkReminder([])).toBeNull();
    const r = newHomeworkReminder([hw("a", ""), hw("b", "")]);
    expect(r?.title).toBe("2 new homework");
  });
});

describe("gamma", () => {
  it("finds the deck link anywhere in a reply", () => {
    expect(findGammaLink({ data: [{ url: "https://gamma.app/docs/abc-123" }] })).toBe(
      "https://gamma.app/docs/abc-123",
    );
    expect(findGammaLink({ url: "https://example.com" })).toBeNull();
  });

  it("puts the topic, task and the student's notes in the brief", () => {
    const brief = deckBrief("Volcanoes", "Explain how they form", "magma rises", 8);
    expect(brief).toContain("8-slide");
    expect(brief).toContain("Volcanoes");
    expect(brief).toContain("magma rises");
  });
});

describe("subject tones", () => {
  it("matches the Bento canvas colours", () => {
    expect(subjectTone("Spanish")).toBe("orange");
    expect(subjectTone("Maths")).toBe("violet");
    expect(subjectTone("Czech")).toBe("pink");
    expect(subjectTone("History")).toBe("yellow");
    expect(subjectTone("Something new")).toBe(subjectTone("Something new"));
  });
});
