import type { Db } from "./claudeRuntime.ts";
import type { Homework } from "./types.ts";

// Moves the student's data from the claude.ai link (which reads Gmail and
// Classroom emails) to the GitHub Pages version (where the microphone works).
// Everything travels inside the link's #fragment, which browsers never send to
// a server, and is merged into what's already on the phone.

export const PAGES_URL = "https://divis950.github.io/openclaw/hub/";
const TAG = "#import=";

/** Device-only or cache keys that shouldn't move between versions. */
const SKIP = [
  "psh.token",
  "psh.mic.blocked",
  "psh.seed.",
  "psh.db/",
  "psh.ai.key",
  "psh.name",
  "psh.classroom.seen",
  "psh.brief",
];
/** Keys where the claude.ai side is the source of truth (backups restore them whole). */
const REPLACE = new Set(["psh.timetable", "psh.courses", "psh.schedule"]);

/**
 * What an #import= link may write: the student's own study data. Anything else
 * (sign-in, AI, sync, notification and backup keys, or made-up keys) is ignored,
 * whoever made the link.
 */
const IMPORT_KEYS = new Set([
  "psh.todos",
  "psh.notes",
  "psh.timetable",
  "psh.courses",
  "psh.schedule",
  "psh.prep",
  "psh.pack",
  "psh.progress",
  "psh.weeklog",
  "psh.grades",
  "psh.events",
  "psh.docs",
  "psh.tutors",
  "psh.tour",
  "psh.theme",
  "psh.accent",
]);
const IMPORT_PREFIXES = ["psh.lab.", "psh.tutor.", "psh.done.", "psh.task."];

export const importable = (key: string) =>
  !SKIP.some((s) => key.startsWith(s)) &&
  (IMPORT_KEYS.has(key) || IMPORT_PREFIXES.some((p) => key.startsWith(p)));

export interface Transfer {
  v: 1;
  name: string;
  homework: Homework[];
  store: Record<string, unknown>;
}

/** Drops big photos (revision pack scans) so the link stays short. */
function slim(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(slim);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        typeof v === "string" && v.startsWith("data:") && v.length > 4000 ? "" : slim(v),
      ]),
    );
  }
  return value;
}

export function collectStore(storage: Storage): Record<string, unknown> {
  const store: Record<string, unknown> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith("psh.") || SKIP.some((s) => key.startsWith(s))) {
      continue;
    }
    try {
      store[key] = slim(JSON.parse(storage.getItem(key) ?? "null"));
    } catch {
      // Not JSON: leave it behind.
    }
  }
  return store;
}

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Any JSON → a short link-safe code (compressed). */
export async function packJson(value: unknown): Promise<string> {
  const bytes = await pipe(
    new TextEncoder().encode(JSON.stringify(value)),
    new CompressionStream("deflate-raw"),
  );
  return toBase64Url(bytes);
}

/** The reverse of packJson; null when the code is damaged. */
export async function unpackJson<T>(code: string): Promise<T | null> {
  try {
    const bytes = await pipe(fromBase64Url(code), new DecompressionStream("deflate-raw"));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export async function encodeTransfer(t: Transfer): Promise<string> {
  return packJson(t);
}

export async function decodeTransfer(code: string): Promise<Transfer | null> {
  try {
    const bytes = await pipe(fromBase64Url(code), new DecompressionStream("deflate-raw"));
    const t = JSON.parse(new TextDecoder().decode(bytes)) as Transfer;
    return t?.v === 1 && Array.isArray(t.homework) && t.store && typeof t.store === "object"
      ? t
      : null;
  } catch {
    return null;
  }
}

export async function transferLink(t: Transfer): Promise<string> {
  return `${PAGES_URL}${TAG}${await encodeTransfer(t)}`;
}

/** Lists of items with ids merge by id (the phone's copy wins, new ids are added); anything else follows the rules above. */
export function mergeValue(key: string, local: unknown, incoming: unknown): unknown {
  const byId = (list: unknown[]) =>
    list.every((x) => x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string");
  if (Array.isArray(local) && Array.isArray(incoming) && byId(local) && byId(incoming)) {
    const ids = new Set(local.map((x) => (x as { id: string }).id));
    return [...local, ...incoming.filter((x) => !ids.has((x as { id: string }).id))];
  }
  if (key === "psh.progress" && local && incoming) {
    return (local as { xp?: number }).xp! >= (incoming as { xp?: number }).xp! ? local : incoming;
  }
  if (local === null || local === undefined || REPLACE.has(key)) {
    return incoming;
  }
  return local;
}

const isEmpty = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && Object.values(v as object).every(isEmpty));

/** Adds the incoming items whose key isn't on the phone yet; the phone's own items stay. */
function unionBy(local: unknown, incoming: unknown, keyOf: (x: Record<string, unknown>) => string) {
  if (!Array.isArray(local) || !Array.isArray(incoming)) {
    return local;
  }
  const objects = (list: unknown[]) =>
    list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  const have = new Set(objects(local).map(keyOf));
  return [...local, ...objects(incoming).filter((x) => !have.has(keyOf(x)))];
}

const k = (...parts: unknown[]) => parts.map((p) => String(p ?? "")).join("|");

/**
 * How a link's value joins what's on the phone. Unlike a backup, a link never
 * replaces the timetable, classes or study plan the student already has: new
 * lessons, classes, posts, tests and days are added next to theirs.
 */
export function mergeImported(key: string, local: unknown, incoming: unknown): unknown {
  if (!REPLACE.has(key)) {
    return mergeValue(key, local, incoming);
  }
  if (isEmpty(local)) {
    return incoming;
  }
  if (key === "psh.timetable") {
    return unionBy(local, incoming, (l) => k(l.day, l.start));
  }
  if (key === "psh.courses") {
    if (!Array.isArray(local) || !Array.isArray(incoming)) {
      return local;
    }
    // Same class: keep the phone's, plus any posts it hasn't seen.
    const merged = local.map((c) => {
      const same = incoming.find(
        (x) => x && typeof x === "object" && (x as { name?: unknown }).name === c?.name,
      ) as { posts?: unknown } | undefined;
      return same && c && typeof c === "object"
        ? {
            ...c,
            posts: unionBy((c as { posts?: unknown }).posts ?? [], same.posts ?? [], (p) =>
              k(p.kind, p.title, p.date),
            ),
          }
        : c;
    });
    return unionBy(merged, incoming, (c) => k(c.name));
  }
  // psh.schedule: tests, days and ticks from both.
  const l = (local ?? {}) as Record<string, unknown>;
  const n = (incoming ?? {}) as Record<string, unknown>;
  if (typeof l !== "object" || typeof n !== "object") {
    return local;
  }
  const done = [...(Array.isArray(l.done) ? l.done : []), ...(Array.isArray(n.done) ? n.done : [])];
  return {
    ...l,
    tests: unionBy(l.tests ?? [], n.tests ?? [], (t) => k(t.topic, t.date)),
    days: unionBy(l.days ?? [], n.days ?? [], (d) => k(d.date)),
    done: [...new Set(done.filter((d) => typeof d === "string"))],
  };
}

/** Applies a transfer on this phone; returns how many homework items were new. */
export async function applyTransfer(t: Transfer, storage: Storage, db: Db): Promise<number> {
  for (const [key, incoming] of Object.entries(t.store)) {
    if (!importable(key)) {
      continue;
    }
    let local: unknown;
    try {
      local = JSON.parse(storage.getItem(key) ?? "null");
    } catch {
      local = null;
    }
    try {
      storage.setItem(key, JSON.stringify(mergeImported(key, local, incoming)));
    } catch {
      // Out of space: keep going with the rest.
    }
  }
  if (typeof t.name === "string" && t.name.trim() && !storage.getItem("psh.name")) {
    storage.setItem("psh.name", t.name.trim().slice(0, 60));
  }
  const list = db.doc("data/users/me/state").collection("homework");
  const have = new Set((await list.get()).docs.map((d) => d.id));
  let added = 0;
  for (const hw of t.homework) {
    if (typeof hw?.id !== "string" || typeof hw.title !== "string") {
      continue;
    }
    const ref = list.doc(hw.id);
    if (have.has(hw.id)) {
      // Keep the phone's own tick, but take a done from the claude.ai side.
      if (hw.done) {
        await ref.update({ done: true });
      }
      continue;
    }
    await ref.set({
      title: hw.title,
      source: hw.source,
      course: typeof hw.course === "string" ? hw.course : "",
      description: typeof hw.description === "string" ? hw.description : "",
      ...(typeof hw.due === "string" && hw.due ? { due: hw.due } : {}),
      done: hw.done === true,
      createdAt: new Date().toISOString(),
    });
    added++;
  }
  return added;
}

/**
 * On the Pages version: reads a transfer from the address and cleans the
 * address. Nothing is saved here; the student OKs it first (LinkConfirm).
 * Null without one, "damaged" when it can't be read.
 */
export async function readTransferFromLocation(): Promise<Transfer | null | "damaged"> {
  const hash = window.location.hash;
  if (!hash.startsWith(TAG)) {
    return null;
  }
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return (await decodeTransfer(hash.slice(TAG.length))) ?? "damaged";
}

/** [one, many] for each list a transfer can bring in. */
const LABELS: Record<string, [string, string]> = {
  "psh.todos": ["to-do", "to-dos"],
  "psh.notes": ["note", "notes"],
  "psh.timetable": ["lesson in the timetable", "lessons in the timetable"],
  "psh.courses": ["class", "classes"],
  "psh.prep": ["test", "tests"],
  "psh.tutors": ["tutor", "tutors"],
  "psh.events": ["calendar event", "calendar events"],
};

/** What a transfer would bring in, line by line, for the student to OK first. */
export function transferPreview(t: Transfer, storage: Storage): string[] {
  const lines: string[] = [];
  const homework = t.homework.filter((h) => typeof h?.title === "string").length;
  if (homework) {
    lines.push(`${homework} homework`);
  }
  let other = 0;
  for (const [key, value] of Object.entries(t.store)) {
    if (!importable(key)) {
      continue;
    }
    const label = LABELS[key];
    if (key === "psh.tutors" && Array.isArray(value)) {
      // Tutors can send work later, so say exactly who is being added.
      let mine: { id?: string }[] = [];
      try {
        const parsed: unknown = JSON.parse(storage.getItem("psh.tutors") ?? "[]");
        mine = Array.isArray(parsed) ? parsed : [];
      } catch {
        // Damaged list: every tutor in the link counts as new.
      }
      const known = new Set(mine.map((t) => t?.id));
      const names = value
        .filter((t) => t && typeof t === "object" && !known.has((t as { id?: string }).id))
        .map((t) => String((t as { name?: unknown }).name ?? "").trim() || "A tutor")
        .slice(0, 4);
      if (names.length) {
        lines.push(
          `New tutor${names.length === 1 ? "" : "s"} who can send you work: ${names.join(", ")}`,
        );
      }
    } else if (label && Array.isArray(value)) {
      if (value.length) {
        lines.push(`${value.length} ${label[value.length === 1 ? 0 : 1]}`);
      }
    } else if (key === "psh.schedule") {
      lines.push("Study plan");
    } else {
      other++;
    }
  }
  if (other) {
    lines.push(`${other} other ${other === 1 ? "setting" : "settings"}`);
  }
  if (typeof t.name === "string" && t.name.trim() && !storage.getItem("psh.name")) {
    lines.push(`Your name: ${t.name.trim().slice(0, 60)}`);
  }
  return lines.length ? lines : ["Nothing new"];
}
