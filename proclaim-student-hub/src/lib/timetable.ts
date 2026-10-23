import { WEEKDAYS, type Lesson, type Weekday } from "./aiFeatures.ts";

// Timetable maths: which lessons are on a day, what's on now and what's next.

export const weekdayOf = (d: Date): Weekday => WEEKDAYS[(d.getDay() + 6) % 7];

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function lessonsOn(lessons: Lesson[], day: Weekday): Lesson[] {
  return lessons.filter((l) => l.day === day).toSorted((a, b) => a.start.localeCompare(b.start));
}

/** Days to show as tabs: Mon-Fri, plus weekend days that have lessons. */
export function schoolDays(lessons: Lesson[]): Weekday[] {
  return WEEKDAYS.filter((d, i) => i < 5 || lessons.some((l) => l.day === d));
}

export interface NowNext {
  current: Lesson | null;
  /** Minutes until the current lesson ends. */
  left: number;
  next: Lesson | null;
  /** Minutes until the next lesson starts (only when it's today). */
  until: number | null;
}

export function nowAndNext(lessons: Lesson[], now = new Date()): NowNext {
  const today = lessonsOn(lessons, weekdayOf(now));
  const t = now.getHours() * 60 + now.getMinutes();
  const current =
    today.find((l) => minutes(l.start) <= t && t < minutes(l.end || l.start) + (l.end ? 0 : 60)) ??
    null;
  const next = today.find((l) => minutes(l.start) > t) ?? null;
  return {
    current,
    left: current ? minutes(current.end || current.start) + (current.end ? 0 : 60) - t : 0,
    next,
    until: next ? minutes(next.start) - t : null,
  };
}

/** Share of a lesson that has gone, 0-1. */
export function lessonProgress(lesson: Lesson, now = new Date()): number {
  const start = minutes(lesson.start);
  const end = lesson.end ? minutes(lesson.end) : start + 60;
  const t = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  return Math.min(1, Math.max(0, (t - start) / Math.max(1, end - start)));
}
