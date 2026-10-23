import type { LabPack } from "../lab/model.ts";
import type { Lesson } from "./aiFeatures.ts";
import type { Note, PrepTest, Todo } from "./study.ts";
import { courseName } from "./subjects.ts";
import type { Homework } from "./types.ts";

// Search everything: homework, tests, notes, revision cards, to-dos and lessons
// in one list. Accents don't matter ("ctenarsky" finds "Čtenářský"), and every
// word typed has to appear somewhere in the item.

export type HitKind = "homework" | "test" | "note" | "card" | "todo" | "lesson";

export interface SearchHit {
  kind: HitKind;
  /** The item's own id (for a card: the card's id). */
  id: string;
  title: string;
  sub: string;
  /** For a card: the pack it belongs to. */
  packId?: string;
}

export interface SearchSources {
  homework: Homework[];
  tests: PrepTest[];
  notes: Note[];
  packs: LabPack[];
  todos: Todo[];
  lessons: Lesson[];
}

export const HIT_ORDER: HitKind[] = ["homework", "test", "note", "card", "todo", "lesson"];

const PER_KIND: Record<HitKind, number> = {
  homework: 8,
  test: 5,
  note: 6,
  card: 6,
  todo: 5,
  lesson: 4,
};

/** Lower case without accents, so Czech words match however they're typed. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The words of a query, folded; empty when there's nothing to look for. */
function terms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/**
 * How well an item matches: 0 = not at all. A title that starts with the first
 * word beats a title that has every word, which beats a match in the body.
 */
function score(words: string[], title: string, rest: string): number {
  const t = fold(title);
  const all = `${t} ${fold(rest)}`;
  if (!words.every((w) => all.includes(w))) {
    return 0;
  }
  if (t.startsWith(words[0])) {
    return 3;
  }
  return words.every((w) => t.includes(w)) ? 2 : 1;
}

/** A short piece of the body around the first match, for a note's second line. */
export function snippet(body: string, query: string, width = 70): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const first = terms(query)[0];
  const at = first ? fold(flat).indexOf(first) : -1;
  if (at < 0 || flat.length <= width) {
    return flat.slice(0, width) + (flat.length > width ? "…" : "");
  }
  const start = Math.max(0, at - Math.floor(width / 3));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + width).trim()}${start + width < flat.length ? "…" : ""}`;
}

/** "Mon 19 Oct" for a YYYY-MM-DD day; anything else as it is. */
function niceDay(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : day;
}

/** Every match for the query, best first within each kind, kinds in HIT_ORDER. */
export function searchEverything(query: string, src: SearchSources): SearchHit[] {
  const words = terms(query);
  if (words.length === 0) {
    return [];
  }
  const ranked: Record<HitKind, { hit: SearchHit; s: number }[]> = {
    homework: [],
    test: [],
    note: [],
    card: [],
    todo: [],
    lesson: [],
  };
  const add = (kind: HitKind, s: number, hit: SearchHit) => {
    if (s > 0) {
      ranked[kind].push({ hit, s });
    }
  };

  for (const h of src.homework) {
    const course = courseName(h.course);
    // Done homework still shows, below the work that's still open.
    add("homework", score(words, h.title, `${course} ${h.description}`) - (h.done ? 0.5 : 0), {
      kind: "homework",
      id: h.id,
      title: h.title,
      sub: [course, h.done ? "done" : ""].filter(Boolean).join(" · "),
    });
  }
  for (const t of src.tests) {
    add("test", score(words, `${t.subject} ${t.topic}`, ""), {
      kind: "test",
      id: t.id,
      title: t.topic || t.subject,
      sub: [t.subject, niceDay(t.date)].filter(Boolean).join(" · "),
    });
  }
  for (const n of src.notes) {
    add("note", score(words, n.title, `${n.subject} ${n.body}`), {
      kind: "note",
      id: n.id,
      title: n.title || "Untitled note",
      sub: snippet(n.body, query) || n.subject,
    });
  }
  for (const p of src.packs) {
    for (const item of p.items) {
      add("card", score(words, item.prompt, `${item.answer} ${p.topic}`), {
        kind: "card",
        id: item.id,
        title: item.prompt,
        sub: `${item.answer} · ${p.topic || p.subject}`,
        packId: p.id,
      });
    }
  }
  for (const t of src.todos) {
    add("todo", score(words, t.text, t.subject) - (t.done ? 0.5 : 0), {
      kind: "todo",
      id: t.id,
      title: t.text,
      sub: [t.subject, t.done ? "done" : t.due].filter(Boolean).join(" · "),
    });
  }
  for (const l of src.lessons) {
    add("lesson", score(words, l.subject, l.room), {
      kind: "lesson",
      id: `${l.day}-${l.start}`,
      title: l.subject,
      sub: [`${l.day} ${l.start}`, l.room ? `Room ${l.room}` : ""].filter(Boolean).join(" · "),
    });
  }

  return HIT_ORDER.flatMap((kind) =>
    ranked[kind]
      // Best match first, finished work after work still to do; ties keep saved order.
      .toSorted((a, b) => b.s - a.s)
      .slice(0, PER_KIND[kind])
      .map((r) => r.hit),
  );
}
