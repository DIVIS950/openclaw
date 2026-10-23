import type { Lesson, Weekday } from "./aiFeatures.ts";
import { progress, weekLog } from "./store.ts";
import { addDays, dayOf, type PrepTest } from "./study.ts";
import { courseName } from "./subjects.ts";
import { lessonsOn, weekdayOf } from "./timetable.ts";
import type { Email, Homework } from "./types.ts";

// Pack my bag: tonight's checklist for the next school day, from the
// timetable (PE → kit), homework to hand in, tests, and teachers' "bring your…"
// notes in recent Classroom emails. Ticks are kept per day.

export interface BagItem {
  id: string;
  text: string;
  /** Why it's on the list: a subject, "Every day", "Hand in", a teacher's note. */
  why: string;
  kind: "basic" | "lesson" | "handin" | "test" | "note" | "mine";
}

/** Things a subject usually needs; matched on the short subject name. */
const BY_SUBJECT: [RegExp, string[]][] = [
  [/\b(pe|p\.e\.|sport|games|physical)/i, ["PE kit", "Trainers", "Water bottle"]],
  [/\bswim/i, ["Swimming kit", "Towel"]],
  [/\bmusic/i, ["Laptop (Music)", "Headphones"]],
  [/\bart\b|\bdesign|\bdt\b/i, ["Sketchbook", "Apron"]],
  [/scien|biolog|chemist|physic/i, ["Calculator", "Science book"]],
  [/math/i, ["Calculator", "Ruler and protractor"]],
  [/computer|\bict\b/i, ["Laptop", "Charger"]],
  [/spanish|french|german|český|czech|english/i, ["Exercise book"]],
];

const BASICS = ["Pencil case", "Laptop and charger", "Planner", "Water bottle"];

/** The day the bag is for: tomorrow, skipping days with no lessons (Fri → Mon). */
export function bagDay(lessons: Lesson[], now = new Date()): { date: string; day: Weekday } {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const day = weekdayOf(d);
    // No timetable yet: any weekday counts.
    const school =
      lessons.length > 0 ? lessonsOn(lessons, day).length > 0 : day !== "Sat" && day !== "Sun";
    if (school) {
      return { date: dayOf(d), day };
    }
  }
  const d = new Date(now);
  d.setDate(now.getDate() + 1);
  return { date: dayOf(d), day: weekdayOf(d) };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9á-ž]+/gi, "-")
    .slice(0, 40);

/** "please also bring your computers" → "your computers"; null when there's none. */
export function bringPhrase(text: string): string | null {
  const m = text.match(
    /\bbring\s+(?:in\s+)?((?:your|a|an|the)\s+[^.!?,;\n]{2,40}|[^.!?,;\n]{2,30})/i,
  );
  if (!m) {
    return null;
  }
  const what = m[1].replace(/\s+(to|for|with|on|tomorrow|today|next)\b.*$/i, "").trim();
  return what.length >= 3 ? what : null;
}

export interface BagInput {
  lessons: Lesson[];
  homework: Homework[];
  tests: PrepTest[];
  emails: Email[];
  mine: Record<string, string[]>;
  now?: Date;
}

export function buildBag(input: BagInput): { date: string; day: Weekday; items: BagItem[] } {
  const now = input.now ?? new Date();
  const { date, day } = bagDay(input.lessons, now);
  const items: BagItem[] = [];
  const seen = new Set<string>();
  const add = (text: string, why: string, kind: BagItem["kind"]) => {
    const key = text.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push({ id: `${kind}-${slug(text)}`, text, why, kind });
  };

  const todays = lessonsOn(input.lessons, day);
  for (const l of todays) {
    const subject = courseName(l.subject);
    for (const [re, things] of BY_SUBJECT) {
      if (re.test(subject)) {
        for (const t of things) {
          add(t, subject, "lesson");
        }
      }
    }
    for (const t of input.mine[subject.toLowerCase()] ?? []) {
      add(t, subject, "mine");
    }
  }
  for (const t of input.mine["every day"] ?? []) {
    add(t, "Every day", "mine");
  }
  for (const t of BASICS) {
    add(t, "Every day", "basic");
  }

  for (const hw of input.homework) {
    if (!hw.done && hw.due && dayOf(new Date(hw.due)) === date) {
      add(`Hand in: ${hw.title}`, courseName(hw.course) || "Homework", "handin");
    }
  }
  for (const t of input.tests) {
    if (t.date === date) {
      add(`Revision notes for ${t.subject} test`, "Test", "test");
    }
  }

  // Teachers' notes from the last three days ("bring your computers").
  const since = addDays(dayOf(now), -3);
  for (const e of input.emails) {
    if (e.date && dayOf(new Date(e.date)) < since) {
      continue;
    }
    const what = bringPhrase(`${e.subject} ${e.snippet}`);
    if (what) {
      const from = e.subject
        .replace(/^(new (announcement|material|assignment):\s*)/i, "")
        .slice(0, 30);
      add(`Bring ${what}`, `Teacher note · ${from}`, "note");
    }
  }
  return { date, day, items };
}

// ---------- Saved: ticks per day, the student's own items ----------

const TICKS = "psh.bag.ticks";
const MINE = "psh.bag.mine";
const DONE = "psh.bag.done";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept: the list still works for now.
  }
}

export const bag = {
  ticks(date: string): string[] {
    const t = read<{ date?: string; ids?: unknown }>(TICKS, {});
    return t.date === date && Array.isArray(t.ids)
      ? t.ids.filter((x) => typeof x === "string")
      : [];
  },
  saveTicks(date: string, ids: string[]) {
    write(TICKS, { date, ids });
  },
  mine(): Record<string, string[]> {
    const m = read<Record<string, unknown>>(MINE, {});
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(m)) {
      if (Array.isArray(v)) {
        out[k] = v.filter((x): x is string => typeof x === "string").slice(0, 20);
      }
    }
    return out;
  },
  addMine(subject: string, text: string) {
    const m = bag.mine();
    const key = subject.toLowerCase();
    m[key] = [...(m[key] ?? []).filter((x) => x.toLowerCase() !== text.toLowerCase()), text].slice(
      -20,
    );
    write(MINE, m);
  },
  removeMine(subject: string, text: string) {
    const m = bag.mine();
    const key = subject.toLowerCase();
    m[key] = (m[key] ?? []).filter((x) => x !== text);
    write(MINE, m);
  },
  /** All ticked for `date`: +5 XP and a packed night, once per date. True when awarded now. */
  packed(date: string): boolean {
    const done = read<{ dates?: unknown }>(DONE, {});
    const dates = Array.isArray(done.dates) ? done.dates.filter((x) => typeof x === "string") : [];
    if (dates.includes(date)) {
      return false;
    }
    write(DONE, { dates: [...dates, date].slice(-60) });
    progress.add(5);
    weekLog.add("bag", 1);
    return true;
  },
};
