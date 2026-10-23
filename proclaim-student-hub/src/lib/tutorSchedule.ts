import type { Tutor } from "./study.ts";

// Tutoring times are typed freely ("Tuesdays 17:00", "po a čt 16:30",
// "Mon & Thu 5pm", "martes 18h"). This reads them well enough to know when
// the next lesson is, for countdowns and reminders.

export interface LessonTime {
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  /** "HH:MM" */
  time: string;
}

/** Day names and short forms (English, Czech, Spanish), longest first so "tue" beats "t". */
const DAY_WORDS: [string, number][] = (
  [
    [["sunday", "sundays", "sun", "neděle", "neděli", "nedele", "ne", "domingo", "dom"], 0],
    [["monday", "mondays", "mon", "pondělí", "pondeli", "po", "lunes", "lun"], 1],
    [["tuesday", "tuesdays", "tues", "tue", "úterý", "utery", "út", "ut", "martes", "mar"], 2],
    [
      [
        "wednesday",
        "wednesdays",
        "wed",
        "středa",
        "středu",
        "streda",
        "st",
        "miércoles",
        "miercoles",
        "mié",
        "mie",
      ],
      3,
    ],
    [
      ["thursday", "thursdays", "thurs", "thu", "čtvrtek", "ctvrtek", "čt", "ct", "jueves", "jue"],
      4,
    ],
    [["friday", "fridays", "fri", "pátek", "patek", "pá", "pa", "viernes", "vie"], 5],
    [
      ["saturday", "saturdays", "sat", "sobota", "sobotu", "so", "sábado", "sabado", "sáb", "sab"],
      6,
    ],
  ] as [string[], number][]
)
  .flatMap(([words, day]) => words.map((w): [string, number] => [w, day]))
  .toSorted((a, b) => b[0].length - a[0].length);

const WEEKDAYS = ["weekdays", "weekday", "všední dny", "entre semana"];

export function parseWhen(when: string): LessonTime | null {
  const text = ` ${when.toLowerCase().replace(/[.,;&+/]/g, " ")} `;

  // Time: 17:00, 17.00 (dots already spaced out, so also "17 00" after "at"), 5pm, 5:30 pm, 18h.
  let time = "";
  const clock = when.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i);
  const ampm = when.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  const h = when.match(/\b(\d{1,2})\s*h\b/i);
  if (clock) {
    time = to24(Number(clock[1]), Number(clock[2]), clock[3]);
  } else if (ampm) {
    time = to24(Number(ampm[1]), 0, ampm[2]);
  } else if (h) {
    time = to24(Number(h[1]), 0);
  }
  if (!time) {
    return null;
  }

  const days = new Set<number>();
  if (WEEKDAYS.some((w) => text.includes(` ${w} `) || text.includes(w))) {
    [1, 2, 3, 4, 5].forEach((d) => days.add(d));
  }
  // Whole words only, so "mar" in "March" or "po" in "pool" don't count.
  const words = new Set(text.split(/\s+/).filter(Boolean));
  for (const [word, day] of DAY_WORDS) {
    if (word.includes(" ") ? text.includes(` ${word} `) : words.has(word)) {
      days.add(day);
    }
  }
  if (days.size === 0) {
    return null;
  }
  return { days: [...days].toSorted(), time };
}

function to24(hour: number, minute: number, suffix?: string): string {
  let hh = hour;
  if (suffix?.toLowerCase() === "pm" && hh < 12) {
    hh += 12;
  }
  if (suffix?.toLowerCase() === "am" && hh === 12) {
    hh = 0;
  }
  if (hh > 23 || minute > 59) {
    return "";
  }
  return `${String(hh).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Lessons count as "on now" for this long after they start. */
export const LESSON_MINUTES = 60;

/** The next (or current) lesson start for a tutor, or null when the time can't be read. */
export function nextLesson(tutor: Pick<Tutor, "when">, now = new Date()): Date | null {
  const parsed = parseWhen(tutor.when);
  if (!parsed) {
    return null;
  }
  const [hh, mm] = parsed.time.split(":").map(Number);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(hh, mm, 0, 0);
    if (parsed.days.includes(d.getDay()) && d.getTime() + LESSON_MINUTES * 60_000 > now.getTime()) {
      return d;
    }
  }
  return null;
}

/** "on now", "in 45 min", "in 3 h", "today 17:00", "tomorrow 17:00", "Thu 17:00". */
export function lessonLabel(start: Date, now = new Date()): string {
  const mins = Math.round((start.getTime() - now.getTime()) / 60_000);
  const time = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
  if (mins <= 0) {
    return "on now";
  }
  if (mins < 60) {
    return `in ${mins} min`;
  }
  const dayDiff = Math.round(
    (new Date(start).setHours(12, 0, 0, 0) - new Date(now).setHours(12, 0, 0, 0)) / 86_400_000,
  );
  if (dayDiff === 0) {
    return mins < 180 ? `in ${Math.floor(mins / 60)} h ${mins % 60} min` : `today ${time}`;
  }
  if (dayDiff === 1) {
    return `tomorrow ${time}`;
  }
  return `${start.toLocaleDateString("en-GB", { weekday: "short" })} ${time}`;
}

/** All tutors' next lessons, soonest first. */
export function upcomingTutoring(
  tutors: Tutor[],
  now = new Date(),
): { tutor: Tutor; start: Date }[] {
  return tutors
    .flatMap((tutor) => {
      const start = nextLesson(tutor, now);
      return start ? [{ tutor, start }] : [];
    })
    .toSorted((a, b) => a.start.getTime() - b.start.getTime());
}

/** Lesson starts for every tutor within the next `days` days (for the week plan). */
export function tutoringInDays(
  tutors: Tutor[],
  from: Date,
  days: number,
): { tutor: Tutor; start: Date }[] {
  const out: { tutor: Tutor; start: Date }[] = [];
  for (const tutor of tutors) {
    const parsed = parseWhen(tutor.when);
    if (!parsed) {
      continue;
    }
    const [hh, mm] = parsed.time.split(":").map(Number);
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setDate(from.getDate() + i);
      d.setHours(hh, mm, 0, 0);
      if (parsed.days.includes(d.getDay())) {
        out.push({ tutor, start: d });
      }
    }
  }
  return out.toSorted((a, b) => a.start.getTime() - b.start.getTime());
}
