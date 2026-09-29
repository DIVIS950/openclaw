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
  get: (): Progress => read<Progress>("psh.progress", { xp: 0, streak: 0, lastDay: "" }),
  add(gain: number): Progress {
    const next = nextProgress(progress.get(), gain, localDay());
    write("psh.progress", next);
    return next;
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
  get: (): SavedSchedule => read<SavedSchedule>("psh.schedule", { tests: [], days: [], done: [] }),
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
  get: (): Course[] => read<Course[]>("psh.courses", []),
  save: (value: Course[]) => write("psh.courses", value),
};

export const timetable = {
  get: (): Lesson[] => read<Lesson[]>("psh.timetable", []),
  save: (value: Lesson[]) => write("psh.timetable", value),
};
