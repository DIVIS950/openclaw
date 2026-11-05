import { progress, weekLog } from "./store.ts";
import { addDays, dayOf, prepPlan, type PrepTest, type Todo } from "./study.ts";
import { courseName } from "./subjects.ts";
import type { Homework } from "./types.ts";

// Plan my evening: tonight in time blocks. Fixed things (tutoring, dinner) stay
// where they are; the rest fills the gaps in order of urgency, with a short
// break after about 50 minutes of work. What doesn't fit is listed, not lost.

export type BlockKind = "homework" | "test" | "revise" | "todo" | "tutor" | "break" | "dinner";

export interface Block {
  id: string;
  kind: BlockKind;
  title: string;
  detail: string;
  /** Minutes since midnight. */
  start: number;
  mins: number;
  /** A homework id, test id… to open it. */
  ref?: string;
}

export interface EveningSettings {
  start: string;
  end: string;
  dinner: string;
}

export const DEFAULT_SETTINGS: EveningSettings = { start: "16:00", end: "21:00", dinner: "18:30" };

export const toMin = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2])) : 0;
};

export const hhmm = (min: number): string =>
  `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export interface EveningInput {
  now: Date;
  homework: Homework[];
  tests: PrepTest[];
  todos: Todo[];
  /** Revision Lab cards due today. */
  labDue: number;
  /** Tutoring lessons today: start time and who. */
  tutoring: { start: Date; name: string; subject: string }[];
  settings: EveningSettings;
}

interface Task {
  id: string;
  kind: BlockKind;
  title: string;
  detail: string;
  mins: number;
  ref?: string;
}

const WORK_BEFORE_BREAK = 50;
const BREAK = 10;

/** What needs doing tonight, most urgent first. */
export function eveningTasks(input: EveningInput): Task[] {
  const today = dayOf(input.now);
  const tomorrow = addDays(today, 1);
  const tasks: Task[] = [];
  const open = input.homework.filter((h) => !h.done);
  const dueDay = (h: Homework) => (h.due ? dayOf(new Date(h.due)) : "9999");
  const byDue = open.toSorted((a, b) => dueDay(a).localeCompare(dueDay(b)));

  for (const h of byDue.filter((h) => dueDay(h) <= tomorrow)) {
    tasks.push({
      id: `hw-${h.id}`,
      kind: "homework",
      title: h.title,
      detail: `${courseName(h.course) || "Homework"} · ${dueDay(h) < today ? "overdue" : dueDay(h) === today ? "due today" : "due tomorrow"}`,
      mins: 40,
      ref: h.id,
    });
  }
  for (const t of input.tests) {
    const step = prepPlan(t, today).find((d) => d.date === today);
    if (step && !t.done.includes(today)) {
      tasks.push({
        id: `test-${t.id}`,
        kind: "test",
        title: `${t.subject} test: ${step.title}`,
        detail:
          step.left === 0
            ? "test today"
            : `test in ${step.left} ${step.left === 1 ? "day" : "days"}`,
        mins: step.minutes,
        ref: t.id,
      });
    }
  }
  if (input.labDue > 0) {
    tasks.push({
      id: "revise",
      kind: "revise",
      title: `Revision Lab: ${input.labDue} ${input.labDue === 1 ? "card" : "cards"} due`,
      detail: "Short and often beats long and rare",
      mins: Math.min(20, Math.max(10, Math.ceil(input.labDue / 2))),
    });
  }
  for (const h of byDue
    .filter((h) => dueDay(h) > tomorrow && dueDay(h) <= addDays(today, 7))
    .slice(0, 2)) {
    tasks.push({
      id: `hw-${h.id}`,
      kind: "homework",
      title: h.title,
      detail: `${courseName(h.course) || "Homework"} · get ahead`,
      mins: 30,
      ref: h.id,
    });
  }
  for (const t of input.todos.filter((t) => !t.done && t.due && t.due <= today).slice(0, 3)) {
    tasks.push({
      id: `todo-${t.id}`,
      kind: "todo",
      title: t.text,
      detail: "To-do",
      mins: 10,
      ref: t.id,
    });
  }
  return tasks;
}

export function buildEvening(input: EveningInput): { blocks: Block[]; leftOver: Task[] } {
  const s = input.settings;
  const nowMin = input.now.getHours() * 60 + input.now.getMinutes();
  const startMin = Math.max(toMin(s.start), Math.ceil(nowMin / 5) * 5);
  const endMin = toMin(s.end) > startMin ? toMin(s.end) : startMin + 180;

  const fixed: Block[] = [];
  const dinner = toMin(s.dinner);
  if (dinner + 30 > startMin && dinner < endMin) {
    fixed.push({
      id: "dinner",
      kind: "dinner",
      title: "Dinner",
      detail: "Phone down, eat, rest",
      start: dinner,
      mins: 30,
    });
  }
  for (const t of input.tutoring) {
    const m = t.start.getHours() * 60 + t.start.getMinutes();
    if (dayOf(t.start) === dayOf(input.now) && m + 60 > startMin && m < endMin) {
      fixed.push({
        id: `tutor-${m}`,
        kind: "tutor",
        title: `Tutoring with ${t.name}`,
        detail: t.subject,
        start: m,
        mins: 60,
      });
    }
  }
  fixed.sort((a, b) => a.start - b.start);

  const blocks: Block[] = [...fixed];
  const leftOver: Task[] = [];
  let cursor = startMin;
  let worked = 0;
  // Moves the cursor past any fixed block it would run into.
  const clear = (mins: number) => {
    let moved = true;
    while (moved) {
      moved = false;
      for (const f of fixed) {
        if (cursor < f.start + f.mins && cursor + mins > f.start) {
          cursor = f.start + f.mins;
          worked = 0;
          moved = true;
        }
      }
    }
  };
  for (const task of eveningTasks(input)) {
    if (worked >= WORK_BEFORE_BREAK) {
      clear(BREAK);
      if (worked >= WORK_BEFORE_BREAK && cursor + BREAK <= endMin) {
        blocks.push({
          id: `break-${cursor}`,
          kind: "break",
          title: "Break",
          detail: "Stand up, drink water, no scrolling",
          start: cursor,
          mins: BREAK,
        });
        cursor += BREAK;
      }
      worked = 0;
    }
    clear(task.mins);
    if (cursor + task.mins > endMin) {
      leftOver.push(task);
      continue;
    }
    blocks.push({ ...task, start: cursor });
    cursor += task.mins;
    worked += task.mins;
  }
  return { blocks: blocks.toSorted((a, b) => a.start - b.start), leftOver };
}

// ---------- Saved: settings and ticks per day ----------

const SETTINGS = "psh.evening.settings";
const TICKS = "psh.evening.ticks";
const DONE = "psh.evening.done";

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
    // Not kept.
  }
}

const isTime = (v: unknown): v is string => typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v);

export const evening = {
  settings(): EveningSettings {
    const s = read<Partial<EveningSettings>>(SETTINGS, {});
    return {
      start: isTime(s.start) ? s.start : DEFAULT_SETTINGS.start,
      end: isTime(s.end) ? s.end : DEFAULT_SETTINGS.end,
      dinner: isTime(s.dinner) ? s.dinner : DEFAULT_SETTINGS.dinner,
    };
  },
  saveSettings(s: EveningSettings) {
    write(SETTINGS, s);
  },
  ticks(date: string): string[] {
    const t = read<{ date?: string; ids?: unknown }>(TICKS, {});
    return t.date === date && Array.isArray(t.ids)
      ? t.ids.filter((x) => typeof x === "string")
      : [];
  },
  /** Ticks a block: +2 XP the first time today. */
  tick(date: string, id: string): string[] {
    const ids = evening.ticks(date);
    if (ids.includes(id)) {
      return ids;
    }
    const next = [...ids, id];
    write(TICKS, { date, ids: next });
    progress.add(2);
    return next;
  },
  untick(date: string, id: string): string[] {
    const next = evening.ticks(date).filter((x) => x !== id);
    write(TICKS, { date, ids: next });
    return next;
  },
  /** Every work block done: +10 XP and a finished plan, once per day. True when awarded now. */
  finished(date: string): boolean {
    const done = read<{ dates?: unknown }>(DONE, {});
    const dates = Array.isArray(done.dates) ? done.dates.filter((x) => typeof x === "string") : [];
    if (dates.includes(date)) {
      return false;
    }
    write(DONE, { dates: [...dates, date].slice(-60) });
    progress.add(10);
    weekLog.add("plan", 1);
    return true;
  },
};
