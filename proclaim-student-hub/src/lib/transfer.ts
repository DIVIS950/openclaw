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
/** Keys where the claude.ai side is the source of truth. */
const REPLACE = new Set(["psh.timetable", "psh.courses", "psh.schedule"]);

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

export async function encodeTransfer(t: Transfer): Promise<string> {
  const bytes = await pipe(
    new TextEncoder().encode(JSON.stringify(t)),
    new CompressionStream("deflate-raw"),
  );
  return toBase64Url(bytes);
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

/** Applies a transfer on this phone; returns how many homework items were new. */
export async function applyTransfer(t: Transfer, storage: Storage, db: Db): Promise<number> {
  for (const [key, incoming] of Object.entries(t.store)) {
    if (!key.startsWith("psh.") || SKIP.some((s) => key.startsWith(s))) {
      continue;
    }
    let local: unknown;
    try {
      local = JSON.parse(storage.getItem(key) ?? "null");
    } catch {
      local = null;
    }
    try {
      storage.setItem(key, JSON.stringify(mergeValue(key, local, incoming)));
    } catch {
      // Out of space: keep going with the rest.
    }
  }
  if (t.name && !storage.getItem("psh.name")) {
    storage.setItem("psh.name", t.name);
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
      course: hw.course,
      description: hw.description ?? "",
      ...(hw.due ? { due: hw.due } : {}),
      done: hw.done === true,
      createdAt: new Date().toISOString(),
    });
    added++;
  }
  return added;
}

/** On the Pages version: reads a transfer from the address, applies it and cleans the address. */
export async function importFromLocation(db: Db): Promise<number | null> {
  const hash = window.location.hash;
  if (!hash.startsWith(TAG)) {
    return null;
  }
  history.replaceState(null, "", window.location.pathname + window.location.search);
  const t = await decodeTransfer(hash.slice(TAG.length));
  return t ? applyTransfer(t, localStorage, db) : null;
}
