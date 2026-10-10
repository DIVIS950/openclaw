import { mergeValue } from "./transfer.ts";

// Automatic saves: everything already saves the moment it changes. On top of
// that, a snapshot of all the app's data is kept once a day (last five days),
// so a bad import or a wrong tap can be undone, and the whole lot can be
// exported to a file and brought back on another phone.

const PREFIX = "psh.backup.";
const KEEP = 5;
const LINK_KEY = "psh.undo.link";
const SKIP = [
  "psh.backup.",
  "psh.undo.",
  "psh.ai.key",
  "psh.token",
  "psh.seed.",
  "psh.db/",
  "tutorhub.",
];

export interface Snapshot {
  at: string;
  data: Record<string, unknown>;
}

function dayOf(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Every piece of the student's data that's worth keeping (no keys, no cache). */
export function collectAll(storage: Storage): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith("psh.") || SKIP.some((s) => key.startsWith(s))) {
      continue;
    }
    try {
      out[key] = JSON.parse(storage.getItem(key) ?? "null");
    } catch {
      out[key] = storage.getItem(key);
    }
  }
  return out;
}

export const backups = {
  list(storage: Storage = localStorage): { day: string; at: string }[] {
    const out: { day: string; at: string }[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) {
        try {
          const s = JSON.parse(storage.getItem(key) ?? "null") as Snapshot;
          out.push({ day: key.slice(PREFIX.length), at: s.at });
        } catch {
          // Damaged snapshot: ignored.
        }
      }
    }
    return out.toSorted((a, b) => b.day.localeCompare(a.day));
  },

  /** Takes today's snapshot if there isn't one yet; drops the oldest beyond five. */
  daily(storage: Storage = localStorage, now = new Date()): boolean {
    const day = dayOf(now);
    if (storage.getItem(PREFIX + day)) {
      return false;
    }
    const data = collectAll(storage);
    if (Object.keys(data).length === 0) {
      return false;
    }
    try {
      storage.setItem(PREFIX + day, JSON.stringify({ at: now.toISOString(), data }));
    } catch {
      // Out of space: drop the oldest and try once more.
      const old = backups.list(storage).at(-1);
      if (old) {
        storage.removeItem(PREFIX + old.day);
        try {
          storage.setItem(PREFIX + day, JSON.stringify({ at: now.toISOString(), data }));
        } catch {
          return false;
        }
      }
    }
    for (const b of backups.list(storage).slice(KEEP)) {
      storage.removeItem(PREFIX + b.day);
    }
    return true;
  },

  /**
   * Right before a link changes anything: today's first save stays as it is
   * ("back to this morning") and a separate save of this moment lets the
   * student undo just this link.
   */
  beforeLink(storage: Storage = localStorage, now = new Date()) {
    backups.daily(storage, now);
    try {
      storage.setItem(
        LINK_KEY,
        JSON.stringify({ at: now.toISOString(), data: collectAll(storage) }),
      );
    } catch {
      // Out of space: the day's save is still there.
    }
  },

  /** The save taken right before the last link, if any. */
  lastLink(storage: Storage = localStorage): Snapshot | null {
    try {
      return JSON.parse(storage.getItem(LINK_KEY) ?? "null") as Snapshot | null;
    } catch {
      return null;
    }
  },

  /** Undoes the last link: puts back the save taken right before it. */
  undoLink(storage: Storage = localStorage): boolean {
    const snap = backups.lastLink(storage);
    if (!snap?.data) {
      return false;
    }
    putBack(snap, storage);
    storage.removeItem(LINK_KEY);
    return true;
  },

  get(day: string, storage: Storage = localStorage): Snapshot | null {
    try {
      return JSON.parse(storage.getItem(PREFIX + day) ?? "null") as Snapshot | null;
    } catch {
      return null;
    }
  },

  /** Puts a snapshot's data back exactly as it was. */
  restore(day: string, storage: Storage = localStorage): boolean {
    const snap = backups.get(day, storage);
    if (!snap) {
      return false;
    }
    putBack(snap, storage);
    return true;
  },
};

function putBack(snap: Snapshot, storage: Storage) {
  for (const key of Object.keys(collectAll(storage))) {
    storage.removeItem(key);
  }
  for (const [key, value] of Object.entries(snap.data)) {
    storage.setItem(key, JSON.stringify(value));
  }
}

/** The export file: everything, as JSON. */
export function exportAll(storage: Storage = localStorage): string {
  return JSON.stringify(
    {
      app: "proclaim-student-hub",
      version: 1,
      at: new Date().toISOString(),
      data: collectAll(storage),
    },
    null,
    1,
  );
}

/** Brings an export file in; lists merge by id, the phone's own copy wins. */
export function importAll(text: string, storage: Storage = localStorage): number {
  let parsed: { app?: string; data?: Record<string, unknown> };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Student Hub backup.");
  }
  if (parsed?.app !== "proclaim-student-hub" || !parsed.data || typeof parsed.data !== "object") {
    throw new Error("That file isn't a Student Hub backup.");
  }
  let keys = 0;
  for (const [key, incoming] of Object.entries(parsed.data)) {
    if (!key.startsWith("psh.") || SKIP.some((s) => key.startsWith(s))) {
      continue;
    }
    let local: unknown = null;
    try {
      local = JSON.parse(storage.getItem(key) ?? "null");
    } catch {
      local = null;
    }
    storage.setItem(key, JSON.stringify(mergeValue(key, local, incoming)));
    keys++;
  }
  return keys;
}
