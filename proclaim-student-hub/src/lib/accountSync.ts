import { type CollectionRef, type DocSnapshot, useCapability } from "./claudeRuntime.ts";
import { applyLocal, collectLocal, mergeSync } from "./syncMerge.ts";

// Sync between the student's devices in the Claude app: the same notes,
// to-dos, tests, timetable, levels and revision packs on the phone, the iPad
// and the computer. It needs no setup: the data goes in the student's own
// private space in this page's database (homework is saved there already),
// so whoever is signed in to Claude on a device gets their own copy.
//
// The copy is one JSON text, cut into parts because a saved document holds at
// most 256 KiB. Each sync writes its parts under a new version name and then
// points the "head" document at them, so a device reading while another one
// writes never sees half of each.

/** Characters per part: under 256 KiB even if every character took 3 bytes. */
export const PART_SIZE = 60_000;
const BASE_KEY = "psh.sync.acct.base";
const AT_KEY = "psh.sync.acct.at";
/** Parts of an unfinished write are left alone this long (another device may be mid-sync). */
const FRESH_MS = 120_000;

interface Head {
  ver: string;
  n: number;
  at: string;
}

interface Part {
  ver: string;
  i: number;
  n: number;
  at: string;
  text: string;
}

/** What the database holds now: the data, or why it can't be trusted this time. */
type Remote =
  | { kind: "empty" }
  | { kind: "ok"; data: Record<string, unknown> }
  /** Parts are missing (two devices wrote at once): this device's copy goes up as it is. */
  | { kind: "broken" };

function asHead(d: Record<string, unknown> | undefined): Head | null {
  return d && typeof d.ver === "string" && typeof d.n === "number" && typeof d.at === "string"
    ? { ver: d.ver, n: d.n, at: d.at }
    : null;
}

function asPart(d: Record<string, unknown> | undefined): Part | null {
  return d &&
    typeof d.ver === "string" &&
    typeof d.i === "number" &&
    typeof d.n === "number" &&
    typeof d.at === "string" &&
    typeof d.text === "string"
    ? { ver: d.ver, i: d.i, n: d.n, at: d.at, text: d.text }
    : null;
}

/** Cuts text into parts without splitting an emoji (a surrogate pair) in two. */
export function cutText(text: string, size = PART_SIZE): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(at + size, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) {
      end--;
    }
    out.push(text.slice(at, end));
    at = end;
  }
  return out.length > 0 ? out : [""];
}

/** The newest complete copy: the one the head names, else the latest whole set of parts. */
export function readRemote(docs: DocSnapshot[]): Remote {
  let head: Head | null = null;
  const byVer = new Map<string, Part[]>();
  for (const doc of docs) {
    if (doc.id === "head") {
      head = asHead(doc.data());
      continue;
    }
    const part = asPart(doc.data());
    if (part) {
      byVer.set(part.ver, [...(byVer.get(part.ver) ?? []), part]);
    }
  }
  const whole = (ver: string): string | null => {
    const parts = byVer.get(ver) ?? [];
    const n = parts[0]?.n ?? 0;
    const sorted = parts.toSorted((a, b) => a.i - b.i);
    return n > 0 && sorted.length === n && sorted.every((p, i) => p.i === i && p.n === n)
      ? sorted.map((p) => p.text).join("")
      : null;
  };
  const named = head ? whole(head.ver) : null;
  const latest =
    named ??
    [...byVer.entries()]
      .toSorted((a, b) => b[1][0].at.localeCompare(a[1][0].at))
      .map(([ver]) => whole(ver))
      .find((t) => t !== null) ??
    null;
  if (latest === null) {
    return head || byVer.size > 0 ? { kind: "broken" } : { kind: "empty" };
  }
  try {
    const file = JSON.parse(latest) as { v?: number; data?: unknown };
    if (file.v === 1 && file.data && typeof file.data === "object" && !Array.isArray(file.data)) {
      return { kind: "ok", data: file.data as Record<string, unknown> };
    }
  } catch {
    // Damaged text: treated like missing parts.
  }
  return { kind: "broken" };
}

function newVersion(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Another device saved its copy while this one was merging: merge again. */
class RacedError extends Error {
  constructor() {
    super("Another device was syncing at the same moment. Try again in a few seconds.");
  }
}

export class NoAccountError extends Error {
  constructor() {
    super("Open Student Hub in the Claude app, signed in, to sync your devices.");
  }
}

export class AccountSync {
  private running: Promise<number> | null = null;

  constructor(
    /** The sync documents in this viewer's own space, or null when there's no account. */
    private readonly getList: () => Promise<CollectionRef | null>,
    private readonly storage: () => Storage,
  ) {}

  get lastSync(): string {
    try {
      return this.storage().getItem(AT_KEY) ?? "";
    } catch {
      return "";
    }
  }

  /**
   * Merges this device with the copy in the account. Returns how many values
   * changed here (0: nothing new). Throws NoAccountError when there's no
   * account to sync with (not in the Claude app, or not signed in).
   */
  sync(): Promise<number> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<number> {
    const list = await this.getList();
    if (!list) {
      throw new NoAccountError();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(list);
      } catch (err) {
        if (!(err instanceof RacedError) || attempt >= 2) {
          throw err;
        }
      }
    }
  }

  private async once(list: CollectionRef): Promise<number> {
    const storage = this.storage();
    const docs = (await list.get()).docs;
    const remote = readRemote(docs);
    const local = collectLocal(storage);
    let base: Record<string, string> = {};
    try {
      base = JSON.parse(storage.getItem(BASE_KEY) ?? "{}") as Record<string, string>;
    } catch {
      // No base: everything is compared as if both devices changed it.
    }
    // A broken copy can't be merged: this device's data goes up unchanged and
    // the other devices merge with it next time (nothing is deleted here).
    // An empty copy (the first device, or the copy was cleared) never removes
    // anything here: every value counts as new on this device.
    const result =
      remote.kind === "ok"
        ? mergeSync(base, local, remote.data)
        : mergeSync({}, local, remote.kind === "broken" ? local : {});
    // Saved up there first: if another device got in between, nothing here
    // has changed yet and the merge simply runs again.
    if (result.upload || remote.kind !== "ok") {
      await this.write(list, result.merged, docs);
    }
    const changed = applyLocal(storage, result.toLocal);
    try {
      storage.setItem(BASE_KEY, JSON.stringify(result.base));
      storage.setItem(AT_KEY, new Date().toISOString());
    } catch {
      // The next sync compares everything again; nothing is lost.
    }
    return changed;
  }

  private async write(list: CollectionRef, data: Record<string, unknown>, before: DocSnapshot[]) {
    const ver = newVersion();
    const at = new Date().toISOString();
    const parts = cutText(JSON.stringify({ v: 1, data }));
    // Parts first, a few at a time, then the head that points at them.
    for (let i = 0; i < parts.length; i += 4) {
      await Promise.all(
        parts
          .slice(i, i + 4)
          .map((text, j) =>
            list.doc(`p-${ver}-${i + j}`).set({ ver, i: i + j, n: parts.length, at, text }),
          ),
      );
    }
    const seen = asHead(before.find((d) => d.id === "head")?.data())?.ver ?? null;
    const head = await list.doc("head").get();
    if ((head.exists ? (asHead(head.data())?.ver ?? null) : null) !== seen) {
      throw new RacedError();
    }
    await list.doc("head").set({ ver, n: parts.length, at });
    // Old parts go, except very new ones another device may still be pointing its head at.
    const now = Date.now();
    const stale = before.filter((doc) => {
      const part = asPart(doc.data());
      return part && part.ver !== ver && now - (Date.parse(part.at) || 0) > FRESH_MS;
    });
    await Promise.all(
      stale.map((doc) =>
        list
          .doc(doc.id)
          .delete()
          .catch(() => undefined),
      ),
    );
  }
}

/** data/users/<this viewer>/state/sync: private to whoever is signed in. */
async function syncList(): Promise<CollectionRef | null> {
  const [db, user] = await Promise.all([useCapability("db"), useCapability("user")]);
  const id = user ? await user.id().catch(() => null) : null;
  return db && id ? db.doc(`data/users/${id}/state`).collection("sync") : null;
}

export const accountSync = new AccountSync(syncList, () => localStorage);
