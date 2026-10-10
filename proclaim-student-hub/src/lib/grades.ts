// Grades tracker: marks from real tests, kept on this device. Shows how each
// subject is going and which one needs the most work next.

export interface Grade {
  id: string;
  subject: string;
  topic: string;
  /** YYYY-MM-DD of the test. */
  date: string;
  score: number;
  outOf: number;
  /** The prep test this grade belongs to, if any. */
  testId: string;
}

function read(): Grade[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("psh.grades") ?? "[]");
    // Damaged entries (not a grade with numbers) are left out.
    return Array.isArray(value)
      ? (
          value.filter(
            (g) =>
              !!g &&
              typeof g === "object" &&
              typeof g.score === "number" &&
              typeof g.outOf === "number" &&
              g.outOf > 0,
          ) as Grade[]
        ).map((g) => ({
          ...g,
          id: String(g.id ?? ""),
          subject: String(g.subject ?? ""),
          topic: String(g.topic ?? ""),
          date: String(g.date ?? ""),
          testId: String(g.testId ?? ""),
        }))
      : [];
  } catch {
    return [];
  }
}

export const grades = {
  all: read,
  save(list: Grade[]) {
    try {
      localStorage.setItem("psh.grades", JSON.stringify(list));
    } catch {
      // Not remembered.
    }
  },
  add(fields: Omit<Grade, "id">): Grade[] {
    const next = [
      { ...fields, id: `g${Date.now().toString(36)}` },
      ...read().filter((g) => !fields.testId || g.testId !== fields.testId),
    ];
    grades.save(next);
    return next;
  },
};

export const percent = (g: Pick<Grade, "score" | "outOf">): number =>
  g.outOf > 0 ? Math.round((g.score / g.outOf) * 100) : 0;

/** A letter for a percentage, the way the school reports it. */
export function letter(p: number): string {
  return p >= 90 ? "A*" : p >= 80 ? "A" : p >= 70 ? "B" : p >= 60 ? "C" : p >= 50 ? "D" : "E";
}

export interface SubjectGrades {
  subject: string;
  average: number;
  count: number;
  /** Latest grade compared with the one before. */
  trend: "up" | "down" | "flat";
  latest: Grade;
}

/** Per-subject averages, weakest first, so the one to work on is at the top. */
export function bySubject(list: Grade[]): SubjectGrades[] {
  const groups = new Map<string, Grade[]>();
  for (const g of list) {
    const key = g.subject.trim() || "Other";
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  return [...groups.entries()]
    .map(([subject, gs]) => {
      const sorted = gs.toSorted((a, b) => b.date.localeCompare(a.date));
      const average = Math.round(gs.reduce((n, g) => n + percent(g), 0) / gs.length);
      const [latest, before] = sorted;
      const diff = before ? percent(latest) - percent(before) : 0;
      return {
        subject,
        average,
        count: gs.length,
        trend: diff > 3 ? "up" : diff < -3 ? "down" : "flat",
        latest,
      } as SubjectGrades;
    })
    .toSorted((a, b) => a.average - b.average);
}

/** "18/20" or "85%" or "18 out of 20" → score and outOf. */
export function parseScore(text: string): { score: number; outOf: number } | null {
  const t = text.trim();
  const frac = t.match(/^(\d+(?:\.\d+)?)\s*(?:\/|out of|of|z)\s*(\d+(?:\.\d+)?)$/i);
  if (frac) {
    return { score: Number(frac[1]), outOf: Number(frac[2]) };
  }
  const pct = t.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pct) {
    return { score: Number(pct[1]), outOf: 100 };
  }
  return null;
}
