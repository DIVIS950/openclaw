import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMany,
  calendarPlan,
  homeworkItem,
  MAX_PER_RUN,
  reportLine,
  testItem,
  tutorItem,
} from "../src/lib/calendarPlan.ts";
import { newClassroomTasks } from "../src/lib/classroomSync.ts";
import type { Mcp } from "../src/lib/claudeRuntime.ts";
import { calendarAdded, eventInput } from "../src/lib/googleCalendar.ts";
import { oneOfEach, sameTask } from "../src/lib/homeworkFilter.ts";
import { markSeen, newSinceLastLook, titlesLine } from "../src/lib/notify.ts";
import { NOTIFY_DEFAULTS } from "../src/lib/notify.ts";
import type { Tutor } from "../src/lib/study.ts";
import { courseName } from "../src/lib/subjects.ts";
import { mergeBoth, syncable } from "../src/lib/syncMerge.ts";
import { cleanImported, importable } from "../src/lib/transfer.ts";
import { lessonDay } from "../src/lib/tutorSchedule.ts";
import type { Homework } from "../src/lib/types.ts";
import { alertsLabel } from "../src/screens/Notifications.tsx";

// 1.6.0: reminders that reach the phone with the app closed (Google
// Calendar), news of homework the hourly check added, more data in sync and
// a tidier Tutor Hub.

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

// Tuesday 3 November 2026, 14:00
const NOW = new Date(2026, 10, 3, 14, 0);

const hw = (id: string, title: string, due: string | undefined, done = false): Homework =>
  ({ id, title, course: "9i English", due, done }) as Homework;

const ana: Tutor = {
  id: "tu1",
  name: "Ana",
  subject: "Spanish",
  meet: "https://meet.google.com/abc-defg-hij",
  whatsapp: "",
  when: "Tuesdays and Thursdays 17:00",
};

describe("calendar items", () => {
  it("homework and tests keep the keys their own buttons use", () => {
    expect(homeworkItem(hw("h1", "Essay", "2026-11-05T23:59:00"))).toMatchObject({
      key: "hw:h1",
      title: "Due: Essay",
      date: "2026-11-05",
    });
    expect(homeworkItem(hw("h2", "No date", undefined))).toBeNull();
    expect(
      testItem({ id: "t1", subject: "Maths", topic: "Fractions", date: "2026-11-10" }),
    ).toMatchObject({ key: "test:t1", title: "Test: Maths – Fractions", date: "2026-11-10" });
  });

  it("tutoring is one weekly event with a reminder 15 minutes before", () => {
    const item = tutorItem(ana, NOW);
    expect(item).toMatchObject({
      key: "tutor:tu1:24-17:00",
      title: "Tutoring: Ana (Spanish)",
      date: "2026-11-03",
      time: "17:00",
      weekly: [2, 4],
      reminders: [15],
      location: "https://meet.google.com/abc-defg-hij",
    });
    expect(tutorItem({ ...ana, when: "when we can" }, NOW)).toBeNull();
    // Only real call links go in the calendar.
    expect(tutorItem({ ...ana, meet: "javascript:alert(1)" }, NOW)?.location).toBeUndefined();
  });

  it("a weekly event goes to the connector with its time and RRULE", () => {
    const input = eventInput(tutorItem(ana, NOW)!);
    expect(input).toMatchObject({
      summary: "Tutoring: Ana (Spanish)",
      startTime: "2026-11-03T17:00:00",
      endTime: "2026-11-03T18:00:00",
      recurrenceData: ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH"],
      overrideReminders: [{ method: "popup", minutes: 15 }],
      location: "https://meet.google.com/abc-defg-hij",
    });
    expect(input).not.toHaveProperty("allDay");
    // All-day items are as before.
    expect(
      eventInput(testItem({ id: "t", subject: "A", topic: "B", date: "2026-11-10" })),
    ).toMatchObject({
      allDay: true,
      startTime: "2026-11-10T00:00:00",
      endTime: "2026-11-11T00:00:00",
    });
  });

  it("the plan leaves out done and past work", () => {
    const plan = calendarPlan(
      {
        homework: [
          hw("a", "Old", "2026-11-01T10:00:00"),
          hw("b", "Done", "2026-11-06T10:00:00", true),
          hw("c", "Next", "2026-11-04T10:00:00"),
        ],
        tests: [
          {
            id: "t1",
            subject: "Maths",
            topic: "Fractions",
            date: "2026-11-09",
            start: "",
            packId: "",
            done: [],
          },
          {
            id: "t0",
            subject: "Maths",
            topic: "Old",
            date: "2026-10-09",
            start: "",
            packId: "",
            done: [],
          },
        ],
        tutors: [ana],
      },
      NOW,
    );
    expect(plan.map((i) => i.key)).toEqual(["tutor:tu1:24-17:00", "hw:c", "test:t1"]);
  });
});

describe("adding everything at once", () => {
  const items = [
    homeworkItem(hw("h1", "Essay", "2026-11-05T10:00:00"))!,
    homeworkItem(hw("h2", "Poster", "2026-11-06T10:00:00"))!,
  ];

  it("skips what another device already put there, and remembers it", async () => {
    const calls: string[] = [];
    const mcp: Mcp = {
      async callTool(_s, tool, input) {
        calls.push(tool);
        if (tool === "list_events") {
          expect(input).toMatchObject({ fullText: "Added by Student Hub" });
          return {
            payload: {
              events: [{ id: "e1", summary: "Due: Essay", start: { date: "2026-11-05" } }],
            },
          };
        }
        return { payload: { htmlLink: "https://calendar.google.com/e2" } };
      },
    };
    const report = await addMany(mcp, items, NOW);
    expect(report).toEqual({ added: 1, already: 1, left: 0 });
    expect(calls).toEqual(["list_events", "create_event"]);
    expect(calendarAdded.has("hw:h1")).toBe(true);
    expect(calendarAdded.link("hw:h2")).toBe("https://calendar.google.com/e2");
    // Next time nothing is asked at all.
    calls.length = 0;
    expect(await addMany(mcp, items, NOW)).toEqual({ added: 0, already: 2, left: 0 });
    expect(calls).toEqual([]);
  });

  it("stops at the cap and says how many are left", async () => {
    const many = Array.from(
      { length: MAX_PER_RUN + 3 },
      (_, i) => homeworkItem(hw(`m${i}`, `Task ${i}`, "2026-11-07T10:00:00"))!,
    );
    const mcp: Mcp = { callTool: async () => ({ payload: {} }) };
    expect(await addMany(mcp, many, NOW)).toEqual({ added: MAX_PER_RUN, already: 0, left: 3 });
  });

  it("says so when Google Calendar can't be reached at all", async () => {
    const mcp: Mcp = {
      callTool: (_s, tool) =>
        tool === "list_events"
          ? Promise.resolve({ payload: {} })
          : Promise.reject({ code: "server_not_connected", message: "x" }),
    };
    await expect(addMany(mcp, items, NOW)).rejects.toThrow(/Google Calendar/);
    expect(calendarAdded.has("hw:h1")).toBe(false);
  });

  it("reports in one line", () => {
    expect(reportLine({ added: 2, already: 1, left: 0 })).toBe(
      "2 added to Google Calendar, with reminders. 1 was there already.",
    );
    expect(reportLine({ added: 0, already: 0, left: 0 })).toMatch(/already/);
  });

  it("never opens a link that isn't https", () => {
    localStorage.setItem(
      "psh.gcal.added",
      JSON.stringify({ "hw:x": { at: "2026-11-03", link: "javascript:alert(1)" } }),
    );
    expect(calendarAdded.link("hw:x")).toBe("");
  });
});

describe("homework the hourly check added", () => {
  it("the first look only remembers; later ones tell what is new", () => {
    const list = [hw("a", "Essay", undefined), hw("b", "Poster", undefined)];
    expect(newSinceLastLook(list)).toEqual([]);
    const next = [...list, hw("c", "Worksheet", undefined), hw("d", "Old", undefined, true)];
    expect(newSinceLastLook(next).map((h) => h.id)).toEqual(["c"]);
    expect(newSinceLastLook(next)).toEqual([]);
  });

  it("an empty answer forgets nothing, and a pile is a re-import, not news", () => {
    newSinceLastLook([hw("a", "Essay", undefined)]);
    expect(newSinceLastLook([])).toEqual([]);
    const pile = Array.from({ length: 12 }, (_, i) => hw(`p${i}`, `P${i}`, undefined));
    expect(newSinceLastLook([hw("a", "Essay", undefined), ...pile])).toEqual([]);
  });

  it("what this device added itself isn't news next time", () => {
    newSinceLastLook([hw("a", "Essay", undefined)]);
    markSeen([hw("e", "From email", undefined)]);
    expect(
      newSinceLastLook([hw("a", "Essay", undefined), hw("e", "From email", undefined)]),
    ).toEqual([]);
  });

  it("names a few", () => {
    const l = ["A", "B", "C", "D", "E"].map((t) => hw(t, t, undefined));
    expect(titlesLine(l)).toBe("A, B, C and 2 more");
  });
});

describe("alerts in the Claude app", () => {
  it("say Calendar where pop-ups can't get through", () => {
    expect(alertsLabel(NOTIFY_DEFAULTS, "default", true)).toBe("Calendar");
    expect(alertsLabel(NOTIFY_DEFAULTS, "denied", true)).toBe("Calendar");
    expect(alertsLabel(NOTIFY_DEFAULTS, "granted", true)).toBe("5 on");
    expect(alertsLabel(NOTIFY_DEFAULTS, "default")).toBe("Off");
  });
});

describe("more in sync", () => {
  it("bag items and calendar marks travel between devices", () => {
    expect(syncable("psh.bag.mine")).toBe(true);
    expect(syncable("psh.gcal.added")).toBe(true);
    expect(importable("psh.notify.seenHw")).toBe(false);
    expect(syncable("psh.gcal.auto")).toBe(false);
  });

  it("changed on both devices: entries from both are kept", () => {
    expect(
      mergeBoth(
        "psh.gcal.added",
        { "hw:a": { at: "1", link: "" } },
        { "hw:b": { at: "2", link: "" } },
      ),
    ).toEqual({ "hw:a": { at: "1", link: "" }, "hw:b": { at: "2", link: "" } });
    expect(
      mergeBoth("psh.bag.mine", { pe: ["Towel"], art: ["Brush"] }, { pe: ["towel", "Shoes"] }),
    ).toEqual({ pe: ["Towel", "Shoes"], art: ["Brush"] });
  });

  it("a link can't bring in a calendar mark with a script link", () => {
    expect(
      cleanImported("psh.gcal.added", { k: { at: "x", link: "javascript:x" } }),
    ).toBeUndefined();
    expect(cleanImported("psh.gcal.added", { k: { at: "x", link: "" } })).toEqual({
      k: { at: "x", link: "" },
    });
    expect(cleanImported("psh.bag.mine", { pe: [1] })).toBeUndefined();
  });

  it("syncs every few minutes while open, only when nobody is tapping", () => {
    const src = fs.readFileSync("src/pages/useAutoSync.ts", "utf8");
    expect(src).toMatch(/setInterval\(/);
    expect(src).toMatch(/idleNow\(lastTouch\)/);
  });
});

describe("Tutor Hub", () => {
  it("names the lesson's day, not the rule", () => {
    expect(lessonDay(new Date(2026, 10, 3, 17, 0), NOW)).toBe("Today 17:00");
    expect(lessonDay(new Date(2026, 10, 4, 9, 30), NOW)).toBe("Tomorrow 09:30");
    expect(lessonDay(new Date(2026, 10, 5, 17, 0), NOW)).toBe("Thu 5 Nov, 17:00");
  });

  it("chips in one row, four tabs in one row, no hanging timeline dot", () => {
    const tutorCss = fs.readFileSync("src/fix-tutor.css", "utf8");
    expect(tutorCss).toMatch(/\.tutor-hub \.tutor-head \{\s*flex-wrap: wrap;/);
    expect(tutorCss).toMatch(/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    expect(fs.readFileSync("src/fix-polish.css", "utf8")).toMatch(
      /\.timeline-item::before \{\s*content: none;/,
    );
    expect(fs.readFileSync("src/tutor/TutorApp.tsx", "utf8")).toMatch(/lessonDay\(start, now\)/);
  });
});

describe("the same task twice", () => {
  const t = (id: string, title: string, course: string, extra: Partial<Homework> = {}) =>
    ({ id, title, course, description: "", link: "", done: false, ...extra }) as Homework;

  it("knows a short title and the title with a summary are one task", () => {
    expect(
      sameTask(
        t("a", "Slam Poetry", "9i English"),
        t("b", "Slam Poetry: write a poem", "9i English"),
      ),
    ).toBe(true);
    expect(
      sameTask(
        t(
          "a",
          "Dabing - Marťan, odevzdáváme do 15.10.!!",
          "Y9 P - Český jazyk a literatura 2026/2027",
        ),
        t(
          "b",
          "Dabing - Marťan, odevzdáváme do 15.10.!!: role překladatele",
          "Y9 P - Český jazyk a literatura 2026/2027",
        ),
      ),
    ).toBe(true);
    // "Classroom" is no class: it matches the real one.
    expect(
      sameTask(
        t("a", "Catch Up Assignments", "Classroom"),
        t("b", "Catch Up Assignments: finish", "9I Computer Science 26-27"),
      ),
    ).toBe(true);
    // Different tasks stay apart.
    expect(
      sameTask(
        t("a", "Catch Up Assignments", "Classroom"),
        t("b", "Catch Up Assignments Continued", "Classroom"),
      ),
    ).toBe(false);
    expect(sameTask(t("a", "Essay", "9i English"), t("b", "Essay: 500 words", "Y9i History"))).toBe(
      false,
    );
    expect(sameTask(t("a", "Dabing do 14.10.", "Czech"), t("b", "Dabing do 15.10.", "Czech"))).toBe(
      false,
    );
  });

  it("shows one row with the best details, a ticked copy first", () => {
    const list = [
      t("s", "Y9 School - 90 word Text Writing practice", "Y9 SPANISH-ACU", {
        due: "2026-11-04T16:00:00Z",
      }),
      t("x", "Other", "Maths"),
      t("l", "Y9 School - 90 word Text Writing practice: practise the 90-word task", "Classroom", {
        link: "https://classroom.google.com/x",
      }),
    ];
    const shown = oneOfEach(list);
    expect(shown.map((h) => h.id)).toEqual(["x", "l"]);
    expect(shown[1]).toMatchObject({
      course: "Y9 SPANISH-ACU",
      due: "2026-11-04T16:00:00Z",
      link: "https://classroom.google.com/x",
    });
    // Ticked once: that copy is shown, so unticking works.
    const ticked = oneOfEach([{ ...list[0], done: true }, list[2]]);
    expect(ticked).toHaveLength(1);
    expect(ticked[0]).toMatchObject({ id: "s", done: true });
  });

  it("the email sync doesn't add a task already saved with a summary", () => {
    const known = [t("k", "Slam Poetry: write and perform a poem", "9i English")];
    const email = {
      id: "e1",
      kind: "Classroom",
      from: "Google Classroom",
      subject: 'New assignment: "Slam Poetry"',
      snippet: "9i English posted a new assignment in 9i English. Slam Poetry",
      date: "2026-11-03T08:00:00Z",
      unread: true,
    };
    const { tasks } = newClassroomTasks([email as never], known, new Set(), NOW);
    expect(tasks).toEqual([]);
  });

  it("class names drop the teacher and a lone school year", () => {
    expect(courseName("Y9 Math 26/27 Mr Fitz")).toBe("Maths");
    expect(courseName("9I Computer Science 26")).toBe("Computer Science");
    expect(courseName("Y9 Learning Centre 9I")).toBe("Learning Centre");
    expect(courseName("Year 9 Drama")).toBe("Year 9 Drama");
  });
});
