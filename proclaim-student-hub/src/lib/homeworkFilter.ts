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
  const all = [...new Set(list.map((h) => h.course).filter(Boolean))];
  const active = selected !== "All" && all.includes(selected) ? selected : "All";
  const chips = all.slice(0, max);
  // The active one always stays visible, even past the first few.
  if (active !== "All" && !chips.includes(active)) {
    chips.push(active);
  }
  return { chips, active };
}
