import type { Db } from "./claudeRuntime.ts";
import { allowedMeet, realDay } from "./study.ts";
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
const RECORD_LISTS = new Set([
  "psh.todos",
  "psh.notes",
  "psh.timetable",
  "psh.courses",
  "psh.prep",
  "psh.events",
  "psh.tutors",
  "psh.weeklog",
  "psh.tutor.messages",
  "psh.tutor.sessions",
  "psh.tutor.materials",
  "psh.grades",
  "psh.lab.packs",
]);
const isRecord = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);

/**
 * A link's list as it may be saved: only real records (a null or a number in
 * a list would break the screen that shows it), tutors with an id and text
 * fields, and lesson links that are Meet, Zoom or Teams.
 */
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const int = (v: unknown, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
/** Text from a link: numbers become text, objects and lists become "". */
const text = (v: unknown) =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
/** Values that aren't lists of records: what each must look like to be brought in. */
const SHAPES: Record<string, (v: unknown) => boolean> = {
  "psh.progress": (v) => isRecord(v) && int(v.xp, 1_000_000) && int(v.streak, 3660),
  "psh.schedule": (v) =>
    isRecord(v) && Array.isArray(v.tests) && Array.isArray(v.days) && Array.isArray(v.done),
  "psh.lab.settings": isRecord,
  "psh.pack": (v) =>
    isRecord(v) &&
    isRecord(v.pack) &&
    typeof v.pack.subject === "string" &&
    typeof v.pack.topic === "string" &&
    ["match", "flashcards", "quiz"].every((k) =>
      Array.isArray((v.pack as Record<string, unknown>)[k]),
    ),
  "psh.tour": (v) => typeof v === "string",
  "psh.theme": (v) => typeof v === "string",
  "psh.accent": (v) => typeof v === "string",
};
/** The text fields each list's records must have (missing or odd ones become ""). */
const TEXT_FIELDS: Record<string, string[]> = {
  "psh.todos": ["id", "text", "due", "subject", "from"],
  "psh.notes": ["id", "title", "subject", "body", "updatedAt", "packId"],
  "psh.timetable": ["day", "start", "end", "subject", "room"],
  "psh.events": ["id", "title", "date", "time", "subject", "details"],
  "psh.tutor.messages": ["id", "tutorId", "from", "text", "at"],
  "psh.tutor.sessions": ["id", "tutorId", "date", "topic", "notes"],
  "psh.tutor.materials": ["id", "tutorId", "title", "text", "photo", "date"],
  "psh.weeklog": ["day", "kind"],
  "psh.grades": ["id", "subject", "topic", "date", "testId"],
};

const withText = (r: Record<string, unknown>, fields: string[]) => {
  const out = { ...r };
  for (const f of fields) {
    out[f] = text(r[f]);
  }
  return out;
};

export function cleanImported(key: string, incoming: unknown): unknown {
  // Nothing to bring in: the phone keeps what it has.
  if (incoming === null || incoming === undefined) {
    return undefined;
  }
  const shape = SHAPES[key];
  if (shape) {
    return shape(incoming) ? incoming : undefined;
  }
  if (!RECORD_LISTS.has(key)) {
    return incoming;
  }
  const list = Array.isArray(incoming) ? incoming.filter(isRecord) : [];
  if (key === "psh.tutors") {
    return list
      .filter((t) => typeof t.id === "string")
      .map((t) => ({
        ...t,
        name: String(t.name ?? ""),
        subject: String(t.subject ?? ""),
        when: String(t.when ?? ""),
        whatsapp: String(t.whatsapp ?? ""),
        meet: allowedMeet(String(t.meet ?? "")),
      }));
  }
  if (key === "psh.grades") {
    // Record by record: one bad grade doesn't drop the good ones.
    return (
      list
        // A real mark: 0 <= score <= out of <= 1000.
        .filter(
          (g) =>
            num(g.score) &&
            num(g.outOf) &&
            (g.outOf as number) > 0 &&
            (g.outOf as number) <= 1000 &&
            (g.score as number) >= 0 &&
            (g.score as number) <= (g.outOf as number),
        )
        .map((g) => withText(g, TEXT_FIELDS[key]))
    );
  }
  if (key === "psh.lab.packs") {
    // Only packs with at least one card that can be practised.
    return list.filter(
      (p) =>
        typeof p.id === "string" &&
        Array.isArray(p.items) &&
        p.items.some(
          (i) =>
            isRecord(i) &&
            typeof i.prompt === "string" &&
            i.prompt !== "" &&
            typeof i.answer === "string" &&
            i.answer !== "",
        ),
    );
  }
  if (TEXT_FIELDS[key]) {
    return list.map((r) => {
      const out = withText(r, TEXT_FIELDS[key]);
      return key === "psh.todos"
        ? {
            ...out,
            due: realDay(out.due) ? out.due : "",
            done: r.done === true,
          }
        : out;
    });
  }
  if (key === "psh.prep") {
    return list
      .filter((t) => typeof t.id === "string")
      .map((t) => ({
        ...t,
        subject: String(t.subject ?? ""),
        topic: String(t.topic ?? ""),
        date: String(t.date ?? ""),
        start: String(t.start ?? t.date ?? ""),
        packId: String(t.packId ?? ""),
        done: Array.isArray(t.done) ? t.done.filter((d) => typeof d === "string") : [],
      }));
  }
  if (key === "psh.courses") {
    return list.map((c) => ({
      ...c,
      name: String(c.name ?? ""),
      subject: String(c.subject ?? ""),
      posts: Array.isArray(c.posts) ? c.posts.filter(isRecord) : [],
    }));
  }
  return list;
}

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
    const value = cleanImported(key, incoming);
    if (value === undefined) {
      // Damaged or empty in the link: left out, the phone's own value stays.
      continue;
    }
    try {
      storage.setItem(key, JSON.stringify(mergeImported(key, local, value)));
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
      // Only a real date: anything else would show as "Invalid Date".
      ...(typeof hw.due === "string" && hw.due && !Number.isNaN(Date.parse(hw.due))
        ? { due: hw.due }
        : {}),
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
  "psh.grades": ["grade", "grades"],
  "psh.lab.packs": ["revision pack", "revision packs"],
  "psh.tutor.messages": ["tutor message", "tutor messages"],
  "psh.tutor.sessions": ["lesson note", "lesson notes"],
  "psh.tutor.materials": ["tutor material", "tutor materials"],
  "psh.events": ["calendar event", "calendar events"],
};

/** What a transfer would bring in, line by line, for the student to OK first. */
export function transferPreview(t: Transfer, storage: Storage): string[] {
  const lines: string[] = [];
  // Only what this phone doesn't have yet, so a link opened twice says "Nothing new".
  const homework = t.homework.filter(
    (h) =>
      typeof h?.title === "string" &&
      !(typeof h.id === "string" && storage.getItem(`psh.db/data/users/me/state/homework/${h.id}`)),
  ).length;
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
      const names = (cleanImported(key, value) as { id?: string; name?: unknown }[])
        .filter((t) => !known.has(t.id))
        .map((t) => String((t as { name?: unknown }).name ?? "").trim() || "A tutor")
        .slice(0, 4);
      if (names.length) {
        lines.push(
          `New tutor${names.length === 1 ? "" : "s"} who can send you work: ${names.join(", ")}`,
        );
      }
    } else if (label && Array.isArray(value)) {
      let local: unknown = null;
      try {
        local = JSON.parse(storage.getItem(key) ?? "null");
      } catch {
        // Damaged local list: everything in the link counts as new.
      }
      const merged = mergeImported(key, local, cleanImported(key, value));
      const fresh = Array.isArray(merged)
        ? merged.length - (Array.isArray(local) ? local.length : 0)
        : 0;
      if (fresh > 0) {
        lines.push(`${fresh} ${label[fresh === 1 ? 0 : 1]}`);
      }
    } else {
      // A study plan or setting only counts when bringing it in would change something.
      const cleaned = cleanImported(key, value);
      let local: unknown = null;
      try {
        local = JSON.parse(storage.getItem(key) ?? "null");
      } catch {
        // Damaged local value: the link's counts as a change.
      }
      const changes =
        cleaned !== undefined &&
        JSON.stringify(mergeImported(key, local, cleaned)) !== JSON.stringify(local);
      if (changes && key === "psh.schedule") {
        lines.push("Study plan");
      } else if (changes) {
        other++;
      }
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
