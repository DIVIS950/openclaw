// Persisted approval store: pending requests, the owner's decisions and the paused flag.
// Pure module: only node builtins, no runtime imports from OpenClaw.
import { randomInt, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ActionDescriptor, ApprovalStatus, OwnerChannel, PendingEntry } from "./types.js";
import { DEFAULT_APPROVAL_TTL_MINUTES } from "./types.js";

export const STATE_FILE_NAME = "state.json";
export const MAX_ENTRIES = 200;
/** An approval must be used within this time, or it expires. */
export const APPROVED_USE_WINDOW_MS = 10 * 60_000;

const STATUSES: ReadonlySet<string> = new Set<ApprovalStatus>([
  "pending",
  "approved",
  "denied",
  "used",
  "expired",
]);

const CHANNELS: ReadonlySet<string> = new Set<OwnerChannel>(["telegram", "whatsapp"]);

export type DecideResult =
  | { ok: true; entry: PendingEntry }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_pending"; entry: PendingEntry };

export type DecideOptions = {
  /**
   * The owner chat a command came from. The entry must have been sent to that chat, so a key
   * shown in one chat cannot be used from the other.
   */
  channel?: OwnerChannel;
};

export type StoreOptions = {
  /** How long a pending request stays open (default 30 minutes). */
  ttlMinutes?: number;
};

type StateFile = { version: 1; paused: boolean; entries: PendingEntry[] };

/** `<stateDir>/muse-sentinel`, the directory to pass to the ApprovalStore constructor. */
export function resolveStoreDir(stateDir: string): string {
  return path.join(stateDir, "muse-sentinel");
}

function isEntry(value: unknown): value is PendingEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.code === "string" &&
    typeof e.sessionKey === "string" &&
    typeof e.tool === "string" &&
    typeof e.semanticKey === "string" &&
    typeof e.summary === "string" &&
    typeof e.detail === "string" &&
    typeof e.createdAt === "number" &&
    typeof e.expiresAt === "number" &&
    typeof e.status === "string" &&
    STATUSES.has(e.status) &&
    (e.notifiedVia === undefined ||
      (Array.isArray(e.notifiedVia) &&
        e.notifiedVia.every((c) => typeof c === "string" && CHANNELS.has(c))))
  );
}

/**
 * Approval requests and decisions, kept in `<dir>/state.json` (mode 0600, written atomically).
 * Every method is synchronous: the file is small and this keeps concurrent hook calls ordered.
 */
export class ApprovalStore {
  readonly filePath: string;
  private readonly dir: string;
  private readonly now: () => number;
  private ttlMs: number;
  private entries: PendingEntry[] = [];
  private pausedFlag = false;

  constructor(dir: string, now: () => number = Date.now, opts: StoreOptions = {}) {
    this.dir = dir;
    this.filePath = path.join(dir, STATE_FILE_NAME);
    this.now = now;
    this.ttlMs = (opts.ttlMinutes ?? DEFAULT_APPROVAL_TTL_MINUTES) * 60_000;
    this.load();
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  setTtlMinutes(minutes: number): void {
    if (Number.isFinite(minutes) && minutes > 0) {
      this.ttlMs = minutes * 60_000;
    }
  }

  setPaused(paused: boolean): void {
    if (this.pausedFlag !== paused) {
      this.pausedFlag = paused;
      this.save();
    }
  }

  /**
   * Opens an approval request, or returns the open one for the same action and session so a
   * retried call does not notify the owner twice. `notifyVia` lists the owner chats the new
   * request will be sent to.
   */
  create(
    action: ActionDescriptor,
    sessionKey: string,
    notifyVia: readonly OwnerChannel[] = [],
  ): { entry: PendingEntry; isNew: boolean } {
    this.expire();
    const existing = this.entries.find(
      (e) =>
        e.status === "pending" &&
        e.semanticKey === action.semanticKey &&
        e.sessionKey === sessionKey,
    );
    if (existing) {
      return { entry: { ...existing }, isNew: false };
    }
    const now = this.now();
    const entry: PendingEntry = {
      id: randomUUID(),
      code: this.newCode(),
      notifiedVia: [...notifyVia],
      sessionKey,
      tool: action.tool,
      semanticKey: action.semanticKey,
      summary: action.summary,
      detail: action.detail,
      ...(action.url ? { url: action.url } : {}),
      createdAt: now,
      expiresAt: now + this.ttlMs,
      status: "pending",
    };
    this.entries.push(entry);
    this.prune();
    this.save();
    return { entry: { ...entry }, isNew: true };
  }

  /**
   * Records the owner's decision. `idOrCode` is an entry id (HTTP) or the 6-digit code
   * (chat command); codes decide pending or approved entries. A deny of an approval that has
   * not been used yet takes it back. A code that was already used is reported as not_pending.
   * With `opts.channel`, an entry that was not sent to that chat is reported as not_found.
   */
  decide(
    idOrCode: string,
    decision: "approve" | "deny",
    via: string,
    opts: DecideOptions = {},
  ): DecideResult {
    this.expire();
    const key = idOrCode.trim();
    // Newest first: an old finished entry may share a code with a newer one.
    const byCode = (status: ApprovalStatus) =>
      this.entries.findLast((e) => e.status === status && e.code === key);
    const entry =
      this.entries.find((e) => e.id === key) ??
      byCode("pending") ??
      byCode("approved") ??
      byCode("used");
    if (!entry || (opts.channel && !entry.notifiedVia?.includes(opts.channel))) {
      return { ok: false, reason: "not_found" };
    }
    const revoke = decision === "deny" && entry.status === "approved";
    if (entry.status !== "pending" && !revoke) {
      return { ok: false, reason: "not_pending", entry: { ...entry } };
    }
    const now = this.now();
    entry.decidedAt = now;
    entry.decidedVia = via;
    if (decision === "approve") {
      entry.status = "approved";
      entry.expiresAt = now + APPROVED_USE_WINDOW_MS;
    } else {
      entry.status = "denied";
    }
    this.save();
    return { ok: true, entry: { ...entry } };
  }

  /** Uses up an approval for this action and session: true at most once per approval. */
  consume(semanticKey: string, sessionKey: string): PendingEntry | undefined {
    this.expire();
    const entry = this.entries.find(
      (e) =>
        e.status === "approved" &&
        e.semanticKey === semanticKey &&
        e.sessionKey === sessionKey &&
        e.expiresAt > this.now(),
    );
    if (!entry) {
      return undefined;
    }
    entry.status = "used";
    this.save();
    return { ...entry };
  }

  /** A denial of this action in this session within the approval time limit. */
  recentDenial(semanticKey: string, sessionKey: string): PendingEntry | undefined {
    const since = this.now() - this.ttlMs;
    const entry = this.entries.find(
      (e) =>
        e.status === "denied" &&
        e.semanticKey === semanticKey &&
        e.sessionKey === sessionKey &&
        (e.decidedAt ?? e.createdAt) >= since,
    );
    return entry ? { ...entry } : undefined;
  }

  get(id: string): PendingEntry | undefined {
    const entry = this.entries.find((e) => e.id === id);
    return entry ? { ...entry } : undefined;
  }

  /** Open requests, oldest first. */
  pending(): PendingEntry[] {
    this.expire();
    return this.entries
      .filter((e) => e.status === "pending")
      .toSorted((a, b) => a.createdAt - b.createdAt)
      .map((e) => ({ ...e }));
  }

  /** Finished entries, newest decision first. */
  recent(limit = 20): PendingEntry[] {
    this.expire();
    return this.entries
      .filter((e) => e.status !== "pending")
      .toSorted((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))
      .slice(0, Math.max(0, limit))
      .map((e) => ({ ...e }));
  }

  /** Marks pending requests and unused approvals past their deadline as expired. */
  expire(now: number = this.now()): number {
    let changed = 0;
    for (const entry of this.entries) {
      if ((entry.status === "pending" || entry.status === "approved") && entry.expiresAt <= now) {
        entry.status = "expired";
        changed += 1;
      }
    }
    if (changed > 0) {
      this.save();
    }
    return changed;
  }

  /** Re-reads the file (another process or a test may have written it). */
  reload(): void {
    this.load();
  }

  /**
   * A code no retained entry uses, finished ones included, so a code always names one entry and
   * a stale `/ok <code>` for a finished request can never match a newer one.
   */
  private newCode(): string {
    const taken = new Set(this.entries.map((e) => e.code));
    for (;;) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      if (!taken.has(code)) {
        return code;
      }
    }
  }

  /** Keeps at most MAX_ENTRIES: drops the oldest finished entries first, then the oldest open ones. */
  private prune(): void {
    while (this.entries.length > MAX_ENTRIES) {
      const finished = this.entries.findIndex((e) => e.status !== "pending");
      this.entries.splice(finished >= 0 ? finished : 0, 1);
    }
  }

  private load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      this.entries = [];
      this.pausedFlag = false;
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StateFile>;
      this.entries = Array.isArray(parsed.entries) ? parsed.entries.filter(isEntry) : [];
      this.pausedFlag = parsed.paused === true;
    } catch {
      // A corrupt file is kept aside for inspection; the store starts empty.
      try {
        fs.renameSync(this.filePath, `${this.filePath}.corrupt-${this.now()}`);
      } catch {
        // ignore
      }
      this.entries = [];
      this.pausedFlag = false;
    }
  }

  /** Writes a temp file next to the state file, then renames it over (atomic on POSIX). */
  private save(): void {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const data: StateFile = { version: 1, paused: this.pausedFlag, entries: this.entries };
    const tmp = path.join(this.dir, `.${STATE_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // ignore
      }
      throw err;
    }
  }
}
