import { type Lesson, WEEKDAYS } from "./aiFeatures.ts";

/** What the "Now" card shows: the lesson running right now, or the next one today. */
export type NowLesson =
  | { state: "now"; lesson: Lesson; minutesLeft: number; progress: number; after: Lesson | null }
  | { state: "next"; lesson: Lesson; minutesUntil: number }
  | { state: "none" };

const mins = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

export function nowLesson(lessons: Lesson[], now = new Date()): NowLesson {
  const todayIdx = (now.getDay() + 6) % 7;
  const t = now.getHours() * 60 + now.getMinutes();
  const today = lessons
    .filter((l) => WEEKDAYS.indexOf(l.day) === todayIdx)
    .toSorted((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < today.length; i++) {
    const l = today[i];
    const start = mins(l.start);
    // A lesson without an end time counts as 50 minutes.
    const end = l.end ? mins(l.end) : start + 50;
    if (t >= start && t < end) {
      return {
        state: "now",
        lesson: l,
        minutesLeft: end - t,
        progress: Math.min(1, Math.max(0, (t - start) / Math.max(1, end - start))),
        after: today[i + 1] ?? null,
      };
    }
    if (t < start) {
      return { state: "next", lesson: l, minutesUntil: start - t };
    }
  }
  return { state: "none" };
}
