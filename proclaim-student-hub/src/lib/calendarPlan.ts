import { findKey } from "./canva.ts";
import { type Mcp, useCapability } from "./claudeRuntime.ts";
import {
  calendarAdded,
  calendarError,
  type CalendarItem,
  EVENING_BEFORE,
  eventInput,
  localStamp,
  readEvents,
  TWO_EVENINGS_BEFORE,
} from "./googleCalendar.ts";
import { addDays, allowedMeet, dayOf, type PrepTest, realDay, type Tutor } from "./study.ts";
import { courseName } from "./subjects.ts";
import { nextLesson, parseWhen } from "./tutorSchedule.ts";
import type { Homework } from "./types.ts";

// Calendar reminders (More › Notifications): homework, tests and tutoring go
// into the student's Google Calendar with a phone reminder, so the reminder
// comes from the Google Calendar app even when Student Hub is closed. Inside
// the Claude app the hub can't pop up alerts itself, so this is the way
// reminders reach the phone there.

const CALENDAR = "Google Calendar";
const AUTO_KEY = "psh.gcal.auto";
/** At most this many new events per go, so one tap never floods the calendar. */
export const MAX_PER_RUN = 25;
/** Tutoring reminder: minutes before the lesson. */
export const TUTOR_REMINDER = 15;

/** A piece of homework as a calendar item (the same one the task's own button adds). */
export function homeworkItem(hw: Homework): CalendarItem | null {
  if (!hw.due) {
    return null;
  }
  const date = new Date(hw.due);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return {
    key: `hw:${hw.id}`,
    title: `Due: ${hw.title}`,
    date: dayOf(date),
    details: [courseName(hw.course), hw.link].filter(Boolean).join("\n"),
    reminders: [EVENING_BEFORE],
  };
}

/** A test as a calendar item: reminders two evenings and one evening before. */
export function testItem(test: Pick<PrepTest, "id" | "subject" | "topic" | "date">): CalendarItem {
  return {
    key: `test:${test.id}`,
    title: `Test: ${test.subject} – ${test.topic}`,
    date: test.date,
    details: "Revise with Student Hub › Tests.",
    reminders: [EVENING_BEFORE, TWO_EVENINGS_BEFORE],
  };
}

/**
 * A tutor's lessons as one weekly event with a reminder 15 minutes before,
 * or null when their lesson time can't be read. The key includes the time, so
 * a new lesson time is offered again.
 */
export function tutorItem(tutor: Tutor, now = new Date()): CalendarItem | null {
  const parsed = parseWhen(tutor.when);
  const start = nextLesson(tutor, now);
  if (!parsed || !start) {
    return null;
  }
  const meet = allowedMeet(tutor.meet);
  return {
    key: `tutor:${tutor.id}:${parsed.days.join("")}-${parsed.time}`,
    title: `Tutoring: ${tutor.name || "tutor"}${tutor.subject ? ` (${tutor.subject})` : ""}`,
    date: dayOf(start),
    time: parsed.time,
    minutes: 60,
    weekly: parsed.days,
    details: [meet ? `Join: ${meet}` : "", "Notes and homework: Student Hub › Tutoring."]
      .filter(Boolean)
      .join("\n"),
    reminders: [TUTOR_REMINDER],
    ...(meet ? { location: meet } : {}),
  };
}

/** Everything coming up that could go in the calendar: open homework, tests, tutoring. */
export function calendarPlan(
  input: { homework: Homework[]; tests: PrepTest[]; tutors: Tutor[] },
  now = new Date(),
): CalendarItem[] {
  const today = dayOf(now);
  const hw = input.homework
    .filter((h) => !h.done)
    .map(homeworkItem)
    .filter((i): i is CalendarItem => i !== null && i.date >= today);
  const tests = input.tests
    .filter((t) => realDay(t.date) && t.date >= today && t.topic.trim())
    .map(testItem);
  const tutors = input.tutors
    .map((t) => tutorItem(t, now))
    .filter((i): i is CalendarItem => i !== null);
  return [...hw, ...tests, ...tutors].toSorted((a, b) => a.date.localeCompare(b.date));
}

/** The ones this device hasn't added yet. */
export function notInCalendar(items: CalendarItem[]): CalendarItem[] {
  return items.filter((i) => !calendarAdded.has(i.key));
}

const norm = (s: string) => s.trim().toLowerCase();

/** "title|date" for dated events, "title|weekly" for repeating ones. */
const signature = (title: string, date: string, weekly: boolean) =>
  `${norm(title)}|${weekly ? "weekly" : date}`;

/**
 * What this app already put in the calendar between today and `until`
 * (perhaps from another device), so nothing goes in twice.
 */
async function alreadyThere(mcp: Mcp, now: Date, until: string): Promise<Set<string>> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = addDays(until, 2).split("-").map(Number);
  const { payload } = await mcp.callTool(CALENDAR, "list_events", {
    startTime: localStamp(start),
    endTime: localStamp(new Date(y, m - 1, d)),
    fullText: "Added by Student Hub",
    orderBy: "startTime",
    pageSize: 250,
  });
  const out = new Set<string>();
  for (const e of readEvents(payload)) {
    out.add(signature(e.title, e.start.slice(0, 10), false));
    // A weekly event shows up as its single lessons: any of them counts.
    out.add(signature(e.title, "", true));
  }
  return out;
}

export interface AddedReport {
  added: number;
  /** Already in the calendar (from this device or another). */
  already: number;
  /** Left for next time (the cap, or the calendar stopped answering). */
  left: number;
}

/**
 * Adds the items not in the calendar yet, one at a time. Throws when nothing
 * could be added at all (no connector, or Google Calendar didn't answer).
 */
export async function addMany(
  mcp: Mcp,
  items: CalendarItem[],
  now = new Date(),
): Promise<AddedReport> {
  const todo = notInCalendar(items);
  const report: AddedReport = { added: 0, already: items.length - todo.length, left: 0 };
  if (todo.length === 0) {
    return report;
  }
  const last = todo.reduce((max, i) => (i.date > max ? i.date : max), todo[0].date);
  // No answer here only means the check is skipped; this device's own list still counts.
  const there = await alreadyThere(mcp, now, last).catch(() => new Set<string>());
  for (let i = 0; i < todo.length; i++) {
    const item = todo[i];
    if (there.has(signature(item.title, item.date, Boolean(item.weekly?.length)))) {
      calendarAdded.mark(item.key, "");
      report.already++;
      continue;
    }
    if (report.added >= MAX_PER_RUN) {
      report.left = todo.length - i;
      break;
    }
    try {
      const { payload } = await mcp.callTool(CALENDAR, "create_event", eventInput(item));
      const link = findKey(payload, "htmlLink");
      calendarAdded.mark(
        item.key,
        typeof link === "string" && link.startsWith("https://") ? link : "",
      );
      report.added++;
    } catch (err) {
      if (report.added === 0) {
        throw calendarError(err);
      }
      report.left = todo.length - i;
      break;
    }
  }
  return report;
}

/** Same as addMany, through the Claude app's connector. Must follow a tap the first time. */
export async function addAllToCalendar(items: CalendarItem[]): Promise<AddedReport> {
  const mcp = await useCapability("mcp");
  if (!mcp) {
    throw new Error("Open Student Hub in the Claude app to use Google Calendar reminders.");
  }
  return addMany(mcp, items);
}

/** "3 added to Google Calendar. 2 were there already." */
export function reportLine(r: AddedReport): string {
  const parts: string[] = [];
  if (r.added > 0) {
    parts.push(`${r.added} added to Google Calendar, with reminders.`);
  }
  if (r.already > 0) {
    parts.push(`${r.already} ${r.already === 1 ? "was" : "were"} there already.`);
  }
  if (r.left > 0) {
    parts.push(`${r.left} more next time.`);
  }
  return parts.join(" ") || "Everything is in Google Calendar already.";
}

/** "Keep adding new work": new homework and tests go in by themselves (this device). */
export const calendarAuto = {
  get(): boolean {
    try {
      return localStorage.getItem(AUTO_KEY) === "1";
    } catch {
      return false;
    }
  },
  set(on: boolean) {
    try {
      if (on) {
        localStorage.setItem(AUTO_KEY, "1");
      } else {
        localStorage.removeItem(AUTO_KEY);
      }
    } catch {
      // Not kept: it asks again next time.
    }
  },
};
