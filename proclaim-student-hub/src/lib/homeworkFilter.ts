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
  max = 6,
): {
  chips: string[];
  active: string;
} {
  // Grouped by the short name, so "Y9 Spanish" and "Y9 SPANISH-ACU" are one chip.
  // Case doesn't split a chip: "ART" and "Art" are one.
  const all: string[] = [];
  for (const name of list.map((h) => courseName(h.course)).filter(Boolean)) {
    if (!all.some((c) => sameCourse(c, name))) {
      all.push(name);
    }
  }
  const active = selected !== "All" ? (all.find((c) => sameCourse(c, selected)) ?? "All") : "All";
  const chips = all.slice(0, max);
  // The active one always stays visible, even past the first few.
  if (active !== "All" && !chips.includes(active)) {
    chips.push(active);
  }
  return { chips, active };
}
