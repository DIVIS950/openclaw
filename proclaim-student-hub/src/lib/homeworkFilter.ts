import { courseName, sameCourse } from "./subjects.ts";
import type { Homework } from "./types.ts";

/**
 * Subject chips for the Homework list being shown (To do or Done). A chosen
 * subject that has nothing left in that list falls back to "All", so the
 * list can never be filtered by a chip that isn't there.
 */
export function subjectChips(
  list: Homework[],
  selected: string,
  max = 20,
): {
  chips: string[];
  active: string;
} {
  // Grouped by the short name, so "Y9 Spanish" and "Y9 SPANISH-ACU" are one chip.
  // Case doesn't split a chip: "ART" and "Art" are one.
  const counts = new Map<string, { name: string; n: number }>();
  for (const name of list.map((h) => courseName(h.course)).filter(Boolean)) {
    const key = name.toLocaleLowerCase();
    const seen = counts.get(key);
    counts.set(key, { name: seen?.name ?? name, n: (seen?.n ?? 0) + 1 });
  }
  // A fixed order (most homework first, then A–Z) so chips don't jump between loads.
  const all = [...counts.values()]
    .toSorted((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .map((c) => c.name);
  const active = selected !== "All" ? (all.find((c) => sameCourse(c, selected)) ?? "All") : "All";
  const chips = all.slice(0, max);
  // The active one always stays visible, even past the first few.
  if (active !== "All" && !chips.includes(active)) {
    chips.push(active);
  }
  return { chips, active };
}

// ---------- The same task twice ----------
// Classroom work sometimes arrives twice: once with the email's short title
// ("Slam Poetry") and once with a summary after it ("Slam Poetry: write a
// poem…"), or under "Classroom" instead of its class. The list shows it once;
// the saved copies are left as they are.

/** A title as compared: lower case, without trailing "…", "!!" or dots. */
export function titleStem(title: string): string {
  return String(title ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(?:…|\.\.\.)$/, "")
    .replace(/[!?.\s]+$/, "");
}

// Older saved tasks may have no class or title at all.
const courseKey = (raw: string | undefined) => courseName(String(raw ?? "")).toLocaleLowerCase();

/** Same class, or one of them only says "Classroom" (or nothing). */
function sameClass(a: string, b: string): boolean {
  const ca = courseKey(a);
  const cb = courseKey(b);
  return (
    !ca || !cb || ca === "classroom" || cb === "classroom" || ca.startsWith(cb) || cb.startsWith(ca)
  );
}

/** True when one is the other, or the other with ": details" after its title. */
export function sameTask(
  a: Pick<Homework, "title" | "course">,
  b: Pick<Homework, "title" | "course">,
) {
  const ta = String(a.title ?? "");
  const tb = String(b.title ?? "");
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const s = titleStem(short);
  const l = long.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  if (!s || !sameClass(a.course, b.course)) {
    return false;
  }
  // "Catch Up Assignments" and "Catch Up Assignments Continued" stay two tasks.
  return titleStem(long) === s || (l.startsWith(s) && /^[!?.…\s]*:/.test(l.slice(s.length)));
}

/** A real class name beats "Classroom". */
const realCourse = (h: Homework) => (courseKey(h.course) === "classroom" ? "" : h.course);

/**
 * One row per task. The copy shown is a ticked one if any is ticked (so
 * unticking works), else the one with the most detail; what it lacks (a due
 * date, a class, a link) comes from the other copies.
 */
export function oneOfEach(list: Homework[]): Homework[] {
  const groups: Homework[][] = [];
  for (const h of list) {
    const group = groups.find((g) => g.some((x) => sameTask(x, h)));
    if (group) {
      group.push(h);
    } else {
      groups.push([h]);
    }
  }
  const shown = new Map<string, Homework>();
  for (const group of groups) {
    if (group.length === 1) {
      shown.set(group[0].id, group[0]);
      continue;
    }
    const pick = group.toSorted(
      (a, b) =>
        Number(b.done) - Number(a.done) ||
        String(b.title ?? "").length - String(a.title ?? "").length ||
        Number(Boolean(b.due)) - Number(Boolean(a.due)),
    )[0];
    const other = (f: (h: Homework) => string | undefined) =>
      group.map(f).find((v) => Boolean(v)) ?? "";
    shown.set(pick.id, {
      ...pick,
      course: realCourse(pick) || other(realCourse) || pick.course,
      due: pick.due || other((h) => h.due) || undefined,
      link: pick.link || other((h) => h.link),
      description: pick.description || other((h) => h.description),
    });
  }
  // The list keeps its order; hidden copies just drop out.
  return list.flatMap((h) => {
    const s = shown.get(h.id);
    return s ? [s] : [];
  });
}
