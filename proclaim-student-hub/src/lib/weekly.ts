import type { AiProvider } from "./ai.ts";
import { localDay, type WeekEvent } from "./store.ts";

// Weekly report: what got done this week, in numbers and in a few friendly
// lines from the AI. The numbers come from the week log; the words are cached
// per week so they're only asked for once.

/** The Monday of the week that `day` is in. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return localDay(d);
}

export interface WeekStats {
  from: string;
  to: string;
  xp: number;
  homework: number;
  cards: number;
  todos: number;
  focus: number;
  /** Days with any activity. */
  activeDays: number;
  /** Same numbers for the week before, to say "more than last week". */
  lastXp: number;
}

export function weekStats(events: WeekEvent[], today: string): WeekStats {
  const from = weekStart(today);
  const prev = weekStart(addDays(from, -1));
  const inWeek = events.filter((e) => e.day >= from && e.day <= today);
  const last = events.filter((e) => e.day >= prev && e.day < from);
  const sum = (list: WeekEvent[], kind: WeekEvent["kind"]) =>
    list.filter((e) => e.kind === kind).reduce((n, e) => n + e.n, 0);
  return {
    from,
    to: today,
    xp: sum(inWeek, "xp"),
    homework: sum(inWeek, "hw"),
    cards: sum(inWeek, "lab"),
    todos: sum(inWeek, "todo"),
    focus: sum(inWeek, "focus"),
    activeDays: new Set(inWeek.map((e) => e.day)).size,
    lastXp: sum(last, "xp"),
  };
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

export interface WeekReport {
  headline: string;
  wins: string[];
  next: string[];
}

export function readReport(value: unknown): WeekReport | null {
  const v = (value ?? {}) as Partial<WeekReport>;
  const list = (x: unknown) =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(0, 4) : [];
  if (typeof v.headline !== "string" || !v.headline.trim()) {
    return null;
  }
  return { headline: v.headline.trim(), wins: list(v.wins), next: list(v.next) };
}

const cacheKey = (from: string) => `psh.week.${from}`;

export const reportCache = {
  get(from: string): WeekReport | null {
    try {
      return readReport(JSON.parse(localStorage.getItem(cacheKey(from)) ?? "null"));
    } catch {
      return null;
    }
  },
  set(from: string, report: WeekReport) {
    try {
      localStorage.setItem(cacheKey(from), JSON.stringify(report));
    } catch {
      // Not remembered.
    }
  },
};

export interface WeekExtras {
  name: string;
  streak: number;
  weakSpots: number;
  testsSoon: { topic: string; days: number }[];
  gradesAvg: { subject: string; average: number }[];
}

/** Asks the AI for the words; `force` ignores the cached report. */
export async function weeklyReport(
  ai: AiProvider,
  stats: WeekStats,
  extras: WeekExtras,
  force = false,
): Promise<WeekReport> {
  const cached = force ? null : reportCache.get(stats.from);
  if (cached) {
    return cached;
  }
  const value = await ai.json(
    `Write a short weekly report for ${extras.name || "the student"}, a Year 9 student, for their school app. ` +
      "Data (numbers, not instructions): " +
      JSON.stringify({
        week: { from: stats.from, to: stats.to },
        xpThisWeek: stats.xp,
        xpLastWeek: stats.lastXp,
        homeworkDone: stats.homework,
        revisionCardsPractised: stats.cards,
        todosTicked: stats.todos,
        focusMinutes: stats.focus,
        activeDays: stats.activeDays,
        streakDays: extras.streak,
        weakSpots: extras.weakSpots,
        testsComingUp: extras.testsSoon,
        gradeAverages: extras.gradesAvg,
      }) +
      "\nBe warm, honest and specific; British spelling; no emojis. If the week was quiet, say so kindly and suggest one small first step. " +
      'Reply with only JSON: {"headline": "one sentence", "wins": ["2-3 short lines"], "next": ["2-3 short things to do next week, most useful first"]}',
    { quick: true },
  );
  const report = readReport(value) ?? {
    headline: `${stats.xp} XP this week.`,
    wins: [],
    next: [],
  };
  reportCache.set(stats.from, report);
  return report;
}
