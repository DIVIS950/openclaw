import type { SortedItem, SortKind } from "./sorter.ts";

/** First line as the title (short), the whole text as the details. */
export function manualItem(kind: SortKind, text: string, date: string): SortedItem {
  const clean = text.trim();
  const firstLine = clean.split("\n")[0].trim();
  const title = firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
  return {
    kind,
    title,
    subject: "",
    date: kind === "note" ? "" : date,
    time: "",
    details: clean,
  };
}
