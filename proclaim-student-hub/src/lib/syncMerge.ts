import { importable, mergeImported } from "./transfer.ts";

// Keeping two devices the same: a three-way merge of the app's saved data.
// Each device remembers a fingerprint of every value as it was at its last
// sync (the "base"). A value changed only here is sent up, a value changed
// only on the other device is taken, and a value changed on both is merged
// (lists keep everything from both sides). No clocks needed, so a phone with
// the wrong time can't win by accident.

/** Homework saved on the website (one key per task). */
const HOMEWORK_PREFIX = "psh.db/data/users/me/state/homework/";

/** The student's own data: study lists, homework and ticks. Never keys, tokens or device settings. */
export function syncable(key: string): boolean {
  return (key !== "psh.tour" && importable(key)) || key.startsWith(HOMEWORK_PREFIX);
}

/** JSON with object keys sorted, so the same data always gives the same text. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .toSorted()
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A short fingerprint of a value (53-bit cyrb53, as text). */
export function fingerprint(value: unknown): string {
  const str = stableJson(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

/** Both devices changed the same value: keep what each one added. */
export function mergeBoth(key: string, local: unknown, remote: unknown): unknown {
  if (key === "psh.progress" && isRecord(local) && isRecord(remote)) {
    return Number(local.xp ?? 0) >= Number(remote.xp ?? 0) ? local : remote;
  }
  if (key === "psh.timetable" || key === "psh.courses" || key === "psh.schedule") {
    return mergeImported(key, local, remote);
  }
  if (Array.isArray(local) && Array.isArray(remote)) {
    const idOf = (x: unknown) =>
      isRecord(x) && typeof x.id === "string" ? `id:${x.id}` : `v:${stableJson(x)}`;
    const have = new Set(local.map(idOf));
    // This device's copy wins for the same item; the other device's new items join.
    return [...local, ...remote.filter((x) => !have.has(idOf(x)))];
  }
  if (isRecord(local) && isRecord(remote)) {
    // A homework task ticked on either device stays ticked.
    return remote.done === true && local.done !== true ? { ...local, done: true } : local;
  }
  return local;
}

/** The data on this device that travels between devices. */
export function collectLocal(storage: Storage): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !syncable(key)) {
      continue;
    }
    try {
      out[key] = JSON.parse(storage.getItem(key) ?? "null");
    } catch {
      // Not JSON (a plain setting): leave it on this device.
    }
  }
  return out;
}

/** Writes what the merge brought in (undefined: remove). Returns how many values changed. */
export function applyLocal(storage: Storage, toLocal: Record<string, unknown>): number {
  let changed = 0;
  for (const [key, value] of Object.entries(toLocal)) {
    try {
      if (value === undefined) {
        storage.removeItem(key);
      } else {
        storage.setItem(key, JSON.stringify(value));
      }
      changed++;
    } catch {
      // Out of space: that value waits for the next sync.
    }
  }
  return changed;
}

export interface SyncResult {
  /** Everything after the merge: what goes up to the other devices. */
  merged: Record<string, unknown>;
  /** Values to write on this device (undefined: remove the key). */
  toLocal: Record<string, unknown>;
  /** The other devices' copy needs updating. */
  upload: boolean;
  /** Fingerprints of `merged`: the base for the next sync. */
  base: Record<string, string>;
}

/** The three-way merge: base (last sync on this device), this device, the other devices' copy. */
export function mergeSync(
  base: Record<string, string>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): SyncResult {
  const merged: Record<string, unknown> = {};
  const toLocal: Record<string, unknown> = {};
  let upload = false;
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    if (!syncable(key)) {
      continue;
    }
    const hasL = key in local;
    const hasR = key in remote;
    const hl = hasL ? fingerprint(local[key]) : undefined;
    const hr = hasR ? fingerprint(remote[key]) : undefined;
    const hb = base[key];
    if (hl === hr) {
      // Same on both (or gone from both).
      if (hasL) {
        merged[key] = local[key];
      }
    } else if (hl === hb) {
      // Changed (or removed) on the other device only.
      if (hasR) {
        merged[key] = remote[key];
        toLocal[key] = remote[key];
      } else {
        toLocal[key] = undefined;
      }
    } else if (hr === hb) {
      // Changed (or removed) here only.
      if (hasL) {
        merged[key] = local[key];
      }
      upload = true;
    } else {
      // Changed on both. Removed on one side: the other side's edit wins.
      const value = !hasL
        ? remote[key]
        : !hasR
          ? local[key]
          : mergeBoth(key, local[key], remote[key]);
      merged[key] = value;
      if (!hasL || fingerprint(value) !== hl) {
        toLocal[key] = value;
      }
      upload = upload || !hasR || fingerprint(value) !== hr;
    }
  }
  const nextBase: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    nextBase[key] = fingerprint(value);
  }
  return { merged, toLocal, upload, base: nextBase };
}
