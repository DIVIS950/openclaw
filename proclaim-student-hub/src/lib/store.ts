import { normalizePack, type RevisionPack } from "../../shared/pack.ts";
import type { Lesson } from "./aiFeatures.ts";

// Small things kept on this device only: XP, streak and the latest revision pack.

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** A saved list of records: anything that isn't a plain object (a damaged entry) is left out. */
function readList<T>(key: string, strings: string[] = []): T[] {
  const value: unknown = read<unknown>(key, []);
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x))
    .map((x) => {
      // Text fields the screens read: missing or damaged ones become "".
      const out = { ...x };
      for (const k of strings) {
        const v = out[k];
        out[k] = typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
      }
      return out as T;
    });
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: progress just won't be remembered.
  }
}

export interface Progress {
  xp: number;
  streak: number;
  lastDay: string;
}

export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Adds XP and bumps the streak on the first activity of a new day. */
export function nextProgress(p: Progress, gain: number, today: string): Progress {
  if (p.lastDay === today) {
    return { ...p, xp: p.xp + gain };
  }
  const yesterday = new Date(`${today}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const streak = p.lastDay === localDay(yesterday) ? p.streak + 1 : 1;
  return { xp: p.xp + gain, streak, lastDay: today };
}

/** Levels: 100 XP each, so progress is always visible. */
export function level(xp: number): { level: number; percent: number; next: number } {
  const lvl = Math.floor(xp / 100) + 1;
  return { level: lvl, percent: xp % 100, next: lvl * 100 - xp };
}

export const progress = {
  get: (): Progress => {
    // A damaged value (null, a string…) counts as no progress yet, not a crash.
    const p = read<Partial<Progress> | null>("psh.progress", null);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
    return p && typeof p === "object"
      ? {
          xp: num(p.xp),
          streak: num(p.streak),
          lastDay: typeof p.lastDay === "string" ? p.lastDay : "",
        }
      : { xp: 0, streak: 0, lastDay: "" };
  },
  add(gain: number): Progress {
    const next = nextProgress(progress.get(), gain, localDay());
    write("psh.progress", next);
    weekLog.add("xp", gain);
    return next;
  },
};

// ---------- Week log (for the weekly report) ----------

export type WeekKind = "xp" | "hw" | "lab" | "todo" | "focus";

export interface WeekEvent {
  day: string;
  kind: WeekKind;
  n: number;
}

/** Small counters per day: XP earned, homework done, cards practised, to-dos ticked. */
export const weekLog = {
  all: (): WeekEvent[] => readList<WeekEvent>("psh.weeklog", ["day", "kind"]),
  add(kind: WeekKind, n: number, day = localDay()) {
    if (n <= 0) {
      return;
    }
    // Keep about five weeks so old days don't pile up.
    const cutoff = new Date(`${day}T12:00:00`);
    cutoff.setDate(cutoff.getDate() - 35);
    const keep = weekLog.all().filter((e) => e.day >= localDay(cutoff));
    const same = keep.find((e) => e.day === day && e.kind === kind);
    write(
      "psh.weeklog",
      same ? keep.map((e) => (e === same ? { ...e, n: e.n + n } : e)) : [...keep, { day, kind, n }],
    );
  },
  /** Takes back `n` of today's count (an Undo), never below zero. */
  take(kind: WeekKind, n: number, day = localDay()) {
    write(
      "psh.weeklog",
      weekLog
        .all()
        .map((e) => (e.day === day && e.kind === kind ? { ...e, n: Math.max(0, e.n - n) } : e)),
    );
  },
};

export interface SavedPack {
  pack: RevisionPack;
  driveLink: string | null;
}

export const packs = {
  current: (): SavedPack | null => {
    const saved = read<SavedPack | null>("psh.pack", null);
    try {
      return saved ? { ...saved, pack: normalizePack(saved.pack) } : null;
    } catch {
      return null;
    }
  },
  save: (value: SavedPack) => write("psh.pack", value),
};

export interface SavedSchedule {
  tests: { topic: string; date: string }[];
  days: { date: string; items: { topic: string; activity: string; minutes: number }[] }[];
  /** Keys "date|index" of sessions the student has ticked off. */
  done: string[];
}

export const schedule = {
  get: (): SavedSchedule => {
    const s = read<Partial<SavedSchedule> | null>("psh.schedule", null);
    const isObj = (x: unknown) => !!x && typeof x === "object";
    return {
      tests: Array.isArray(s?.tests) ? s.tests.filter(isObj) : [],
      days: Array.isArray(s?.days)
        ? s.days.filter(isObj).map((d) => ({ ...d, items: Array.isArray(d.items) ? d.items : [] }))
        : [],
      done: Array.isArray(s?.done) ? s.done.filter((x) => typeof x === "string") : [],
    };
  },
  save: (value: SavedSchedule) => write("psh.schedule", value),
};

/** One post in a Classroom class stream. */
export interface CoursePost {
  kind: "assignment" | "material" | "announcement";
  title: string;
  /** YYYY-MM-DD it was posted, or "" when unknown. */
  date: string;
  text: string;
}

export interface Course {
  name: string;
  subject: string;
  posts: CoursePost[];
}

/** The student's Classroom classes as they imported them (Classroom itself is blocked). */
export const courses = {
  get: (): Course[] =>
    readList<Course>("psh.courses", ["name", "subject"]).map((c) => ({
      ...c,
      posts: (Array.isArray(c.posts) ? c.posts : [])
        .filter((x) => !!x && typeof x === "object")
        .map((x) => ({
          kind: x.kind,
          title: String(x.title ?? ""),
          date: String(x.date ?? ""),
          text: String(x.text ?? ""),
        })),
    })),
  save: (value: Course[]) => write("psh.courses", value),
};

export const timetable = {
  get: (): Lesson[] =>
    readList<Lesson>("psh.timetable", ["day", "start", "end", "subject", "room"]),
  save: (value: Lesson[]) => write("psh.timetable", value),
};

// ---------- Homework XP, once per homework ----------

const XP_IDS_KEY = "psh.xp.hw";
/** Keeps the newest ids only, so the list can't grow forever. */
const MAX_XP_IDS = 1000;

/** Adds `id` to the awarded list; false when it was already there (no XP again). */
export function awardOnce(awarded: string[], id: string): { awarded: string[]; fresh: boolean } {
  if (awarded.includes(id)) {
    return { awarded, fresh: false };
  }
  return { awarded: [...awarded, id].slice(-MAX_XP_IDS), fresh: true };
}

/**
 * Ticking homework earns +5 XP and counts on the weekly report once per
 * homework: untick and tick again doesn't earn it twice.
 */
export const homeworkXp = {
  awarded: (): string[] => read<string[]>(XP_IDS_KEY, []),
  /** Returns true when XP was awarded now. */
  tick(id: string): boolean {
    const next = awardOnce(homeworkXp.awarded(), id);
    if (!next.fresh) {
      return false;
    }
    write(XP_IDS_KEY, next.awarded);
    progress.add(5);
    weekLog.add("hw", 1);
    return true;
  },
  /** Undo right after a tick: takes back the XP and the report-card count. */
  undo(id: string) {
    const awarded = homeworkXp.awarded();
    if (!awarded.includes(id)) {
      return;
    }
    write(
      XP_IDS_KEY,
      awarded.filter((x) => x !== id),
    );
    const p = progress.get();
    write("psh.progress", { ...p, xp: Math.max(0, p.xp - 5) });
    weekLog.take("hw", 1);
    weekLog.take("xp", 5);
  },
};

const TODO_XP_KEY = "psh.xp.todo";

/** To-do XP, once per to-do: ticking, unticking and ticking again adds nothing. */
export const todoXp = {
  tick(id: string): boolean {
    const next = awardOnce(read<string[]>(TODO_XP_KEY, []), id);
    if (!next.fresh) {
      return false;
    }
    write(TODO_XP_KEY, next.awarded);
    progress.add(2);
    weekLog.add("todo", 1);
    return true;
  },
  /** Unticked again: the XP and the weekly count go back. */
  undo(id: string) {
    const awarded = read<string[]>(TODO_XP_KEY, []);
    if (!awarded.includes(id)) {
      return;
    }
    write(
      TODO_XP_KEY,
      awarded.filter((x) => x !== id),
    );
    const p = progress.get();
    write("psh.progress", { ...p, xp: Math.max(0, p.xp - 2) });
    weekLog.take("todo", 1);
    weekLog.take("xp", 2);
  },
};
