import { type CollectionRef, type Comments, useCapability } from "./claudeRuntime.ts";

// When something breaks, the app tells Claude by itself. Each bug becomes one
// report in the student's own private space in this page's database
// (data/users/<id>/state/errorReports); the hourly check reads new reports,
// fixes the code and ships a version, and the report shows "Fixed in 1.4.1".
// The same bug again only counts up, so one bug is one report. Nothing
// secret goes in: keys, sign-in tokens and email addresses are blanked out.
// The website keeps no line to Claude, so reports only travel from the Claude app.

export type ReportStatus = "new" | "fixing" | "fixed" | "watching";

export interface ErrorReport {
  id: string;
  message: string;
  stack: string;
  /** Where it happened: the screen and what caught it ("today · crash"). */
  where: string;
  version: string;
  device: string;
  firstAt: string;
  at: string;
  count: number;
  status: ReportStatus;
  /** Claude's one-line answer: what was fixed, or why it isn't the app's fault. */
  reply: string;
  fixedIn: string;
}

const STATUSES = new Set<string>(["new", "fixing", "fixed", "watching"]);
const PENDING_KEY = "psh.errors.pending";
/** One write per report this often at most; repeats in between are counted. */
const WRITE_GAP_MS = 10 * 60_000;
const MAX_PENDING = 20;

/** Problems that aren't bugs in the app: the network, a closed tab, a browser quirk. */
const NOISE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Failed to fetch|NetworkError|Load failed|network connection was lost/i,
  /AbortError|The (user|operation) (aborted|was aborted)|cancelled|canceled/i,
  /NotAllowedError|Permission denied|denied by the user/i,
  /Gmail can't be reached|connector is connected|Open Student Hub in the Claude app/i,
  /QuotaExceededError|quota/i,
];

/** Blanks out anything that could unlock an account. */
export function scrub(text: string): string {
  return text
    .replace(/sk-ant-[\w-]+/g, "<key>")
    .replace(/\bAIza[\w-]{20,}/g, "<key>")
    .replace(/\bya29\.[\w.-]+/g, "<token>")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<token>")
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "<key>")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>");
}

/** A short stable id for "this message at this place", so repeats land on one report. */
export function reportId(message: string, where: string): string {
  // Numbers and quoted bits vary between repeats of the same bug.
  const shape = `${message.replace(/\d+/g, "#").replace(/"[^"]*"|'[^']*'/g, "…")}|${where}`;
  let h = 5381;
  for (let i = 0; i < shape.length; i++) {
    h = ((h << 5) + h + shape.charCodeAt(i)) | 0;
  }
  return `e${(h >>> 0).toString(36)}`;
}

/** Programming mistakes (as opposed to a friendly "couldn't reach Gmail"). */
export function isBug(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    err instanceof ReferenceError ||
    err instanceof RangeError ||
    err instanceof SyntaxError
  );
}

export function isNoise(message: string): boolean {
  return !message.trim() || NOISE.some((re) => re.test(message));
}

function describe(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) {
    return { message: `${err.name}: ${err.message}`, stack: err.stack ?? "" };
  }
  if (typeof err === "string") {
    return { message: err, stack: "" };
  }
  try {
    return { message: JSON.stringify(err).slice(0, 300), stack: "" };
  } catch {
    return { message: String(err), stack: "" };
  }
}

export function deviceName(ua = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  const kind = /iPad/.test(ua)
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "Other";
  const browser = /CriOS|Chrome\//.test(ua)
    ? "Chrome"
    : /FxiOS|Firefox\//.test(ua)
      ? "Firefox"
      : /Safari\//.test(ua)
        ? "Safari"
        : "";
  return [kind, browser].filter(Boolean).join(" · ");
}

interface Pending {
  report: ErrorReport;
  /** Repeats not yet written. */
  extra: number;
  writtenAt: number;
}

function readReport(id: string, v: Record<string, unknown>): ErrorReport {
  const s = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
  return {
    id,
    message: s("message"),
    stack: s("stack"),
    where: s("where"),
    version: s("version"),
    device: s("device"),
    firstAt: s("firstAt"),
    at: s("at"),
    count: typeof v.count === "number" && v.count > 0 ? v.count : 1,
    status: STATUSES.has(s("status")) ? (s("status") as ReportStatus) : "new",
    reply: s("reply"),
    fixedIn: s("fixedIn"),
  };
}

const newer = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) > 0;

export class ErrorReporter {
  private flushing: Promise<void> | null = null;
  private reach = false;
  private listeners = new Set<(r: ErrorReport) => void>();
  private toldThisRun = new Set<string>();

  constructor(
    /** The reports in this viewer's own space, or null when there's no account (website, demo). */
    private readonly getList: () => Promise<CollectionRef | null>,
    private readonly storage: () => Storage,
    private readonly version: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** True once this device has reached the account (the Claude app, signed in). */
  get canReach(): boolean {
    return this.reach;
  }

  /** Called once per new bug per run, so the app can say Claude was told. */
  onReport(fn: (r: ErrorReport) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private pending(): Record<string, Pending> {
    try {
      const v = JSON.parse(this.storage().getItem(PENDING_KEY) ?? "{}") as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Pending>) : {};
    } catch {
      return {};
    }
  }

  private savePending(all: Record<string, Pending>) {
    const kept = Object.values(all)
      .toSorted((a, b) => b.report.at.localeCompare(a.report.at))
      .slice(0, MAX_PENDING);
    try {
      this.storage().setItem(
        PENDING_KEY,
        JSON.stringify(Object.fromEntries(kept.map((p) => [p.report.id, p]))),
      );
    } catch {
      // Storage full or blocked: this bug just isn't reported from here.
    }
  }

  /** Notes a problem; returns true when it's kept for Claude (noise is dropped). Never throws. */
  capture(err: unknown, where: string): boolean {
    try {
      const { message: raw, stack: rawStack } = describe(err);
      if (isNoise(raw)) {
        return false;
      }
      const message = scrub(raw).slice(0, 500);
      const stack = scrub(rawStack).slice(0, 2000);
      const id = reportId(message, where);
      const at = new Date(this.now()).toISOString();
      const all = this.pending();
      const known = all[id];
      if (known) {
        known.extra += 1;
        known.report = { ...known.report, at, stack: stack || known.report.stack };
      } else {
        all[id] = {
          report: {
            id,
            message,
            stack,
            where,
            version: this.version,
            device: deviceName(),
            firstAt: at,
            at,
            count: 1,
            status: "new",
            reply: "",
            fixedIn: "",
          },
          extra: 0,
          writtenAt: 0,
        };
      }
      this.savePending(all);
      if (!this.toldThisRun.has(id)) {
        this.toldThisRun.add(id);
        for (const fn of this.listeners) {
          fn(all[id].report);
        }
      }
      void this.flush();
      return true;
    } catch {
      return false;
    }
  }

  /** Writes what's waiting. Safe to call any time; one flush runs at a time. */
  flush(): Promise<void> {
    this.flushing ??= this.run()
      .catch(() => {
        // Kept on the device; the next flush tries again.
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  private async run(): Promise<void> {
    const list = await this.getList();
    this.reach = list !== null;
    if (!list) {
      return;
    }
    const all = this.pending();
    const now = this.now();
    for (const p of Object.values(all)) {
      const fresh = p.writtenAt === 0;
      if (!fresh && (p.extra === 0 || now - p.writtenAt < WRITE_GAP_MS)) {
        continue;
      }
      const ref = list.doc(p.report.id);
      const snap = await ref.get();
      const before = snap.exists ? readReport(p.report.id, snap.data() ?? {}) : null;
      const adds = fresh ? 1 : p.extra;
      let next: ErrorReport;
      if (!before) {
        next = { ...p.report, count: adds };
      } else if (
        before.status === "fixed" &&
        before.fixedIn &&
        !newer(before.fixedIn, this.version)
      ) {
        // Back again in the version that was meant to fix it: it needs another look.
        next = {
          ...before,
          stack: p.report.stack || before.stack,
          at: p.report.at,
          version: this.version,
          device: p.report.device,
          count: before.count + adds,
          status: "new",
          reply: `Came back in ${this.version} after the fix in ${before.fixedIn}.`,
        };
      } else {
        next = {
          ...before,
          stack: p.report.stack || before.stack,
          at: p.report.at,
          count: before.count + adds,
        };
      }
      await ref.set({ ...next });
      p.extra = 0;
      p.writtenAt = now;
      p.report = next;
    }
    // Written reports leave the device after a day; repeats before then still count up.
    const keep = Object.fromEntries(
      Object.entries(all).filter(
        ([, p]) => p.writtenAt === 0 || p.extra > 0 || now - p.writtenAt < 86_400_000,
      ),
    );
    this.savePending(keep);
  }

  /** The reports in the account, newest first ([] where there's no account). */
  async list(): Promise<ErrorReport[]> {
    const list = await this.getList();
    if (!list) {
      return [];
    }
    const snap = await list.get();
    return snap.docs
      .map((d) => readReport(d.id, d.data() ?? {}))
      .filter((r) => r.message)
      .toSorted((a, b) => b.at.localeCompare(a.at));
  }
}

/** The message a "Send to Claude now" tap posts. */
export function reportMessage(r: ErrorReport): string {
  return [
    `Bug report from the Student Hub app (report ${r.id}):`,
    "",
    r.message,
    `Where: ${r.where} · version ${r.version} · ${r.device} · seen ${r.count}×`,
    "",
    "Please find the cause, fix it, test it and publish a new version.",
  ].join("\n");
}

/** Sends one report to the Claude session watching this app. Must follow a tap. */
export async function sendReport(
  comments: Comments,
  r: ErrorReport,
  anchorEl: Element,
): Promise<boolean> {
  try {
    const anchor = await comments.anchorFor(anchorEl);
    await comments.sendToClaude({ anchor, text: reportMessage(r) });
    return true;
  } catch {
    return false;
  }
}

export const REPORT_LABEL: Record<ReportStatus, string> = {
  new: "Claude told",
  fixing: "Fixing",
  fixed: "Fixed",
  watching: "Watching",
};

/** data/users/<this viewer>/state/errorReports: private to whoever is signed in. */
async function reportList(): Promise<CollectionRef | null> {
  const [db, user] = await Promise.all([useCapability("db"), useCapability("user")]);
  const id = user ? await user.id().catch(() => null) : null;
  return db && id ? db.doc(`data/users/${id}/state`).collection("errorReports") : null;
}

export const errorReports = new ErrorReporter(
  reportList,
  () => localStorage,
  typeof __VERSION__ === "string" ? __VERSION__ : "dev",
);
