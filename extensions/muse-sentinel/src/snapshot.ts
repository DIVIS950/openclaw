// Parses browser snapshot text and remembers, per tab, which element each ref points to.
// Pure module: no runtime imports from OpenClaw.
import type { ElementInfo } from "./types.js";

export const MAX_SNAPSHOT_TARGETS = 20;
export const MAX_SNAPSHOT_LINES = 4000;
export const CONTEXT_RADIUS = 6;
export const MAX_LINE_CHARS = 160;
/** Tabs whose last change is remembered (more than the snapshot cache, see SnapshotCache). */
export const MAX_CHANGE_RECORDS = 500;

const START_MARKER_RE = /<<<EXTERNAL_UNTRUSTED_CONTENT id="([^"]*)">>>/g;
const END_MARKER_RE = /<<<END_EXTERNAL_UNTRUSTED_CONTENT id="([^"]*)">>>/g;
const REF_GLOBAL_RE = /\[ref=([a-z0-9]+)\]/gi;
// A JSON-escaped double-quoted string, as Playwright and OpenClaw print element names.
const DOUBLE_QUOTED_RE = /"(?:[^"\\]|\\.)*"/g;
const URL_PROP_RE = /^(\s*)-\s+\/url:\s*(.*)$/;

/**
 * A ref the way the browser reads it: core accepts "@e5" and "ref=e5" for "e5"
 * (pw-session.ts refLocator), so the sentinel must look up the same element.
 */
export function normalizeRef(raw: string | undefined): string | undefined {
  const ref = raw?.trim().replace(/^@/, "").replace(/^ref=/, "").trim();
  return ref || undefined;
}

export type SnapshotElement = {
  ref: string;
  role: string;
  name: string;
  /** Index into the snapshot's line list. */
  index: number;
  /** Position among earlier elements with the same role and name (0 = first). */
  nth: number;
  /** A link's href (the `- /url:` child line). */
  href?: string;
};

export type ParsedSnapshot = {
  lines: string[];
  elements: Map<string, SnapshotElement>;
  /** Line of the focused element (`[active]`), when exactly one non-iframe line has it. */
  activeIndex?: number;
  /** Only set for the JSON "aria" format, which carries the URL inside the text. */
  url?: string;
};

type ParsedLine = { role: string; name: string; refs: string[]; active?: true };

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Returns the page content between the external-content markers. Anchors on the last end
 * marker and its matching start marker (page content cannot contain real markers: the
 * wrapper sanitizes them), then drops the "Source: ..." metadata header up to "---".
 * Falls back to the whole text when there are no markers.
 */
export function extractSnapshotBody(text: string): string {
  const ends = [...text.matchAll(END_MARKER_RE)];
  const end = ends.at(-1);
  if (!end || end.index === undefined) {
    return text;
  }
  const id = end[1] ?? "";
  const start = [...text.slice(0, end.index).matchAll(START_MARKER_RE)].find((m) => m[1] === id);
  if (!start || start.index === undefined) {
    return text;
  }
  const inner = text.slice(start.index + start[0].length, end.index);
  const lines = inner.split("\n");
  const sep = lines.findIndex((line) => line.trim() === "---");
  // The header is short ("Source: Browser" plus optional From/Subject lines).
  const body = sep >= 0 && sep <= 4 ? lines.slice(sep + 1) : lines;
  return body.join("\n").replace(/^\n+|\n+$/g, "");
}

/** Undoes YAML single quoting (`'...'` with `''` for a quote) of a Playwright key. */
function unwrapSingleQuoted(key: string): string {
  if (!key.startsWith("'")) {
    return key;
  }
  let out = "";
  for (let i = 1; i < key.length; i += 1) {
    const ch = key[i];
    if (ch === "'") {
      if (key[i + 1] === "'") {
        out += "'";
        i += 1;
        continue;
      }
      return out;
    }
    out += ch;
  }
  return out;
}

function decodeName(quoted: string): string {
  try {
    const value: unknown = JSON.parse(quoted);
    return typeof value === "string" ? value : quoted.slice(1, -1);
  } catch {
    return quoted.slice(1, -1).replace(/\\(.)/g, "$1");
  }
}

/** The key part of a `key: value` line: everything before the first `: ` outside double quotes. */
function keyPart(key: string): string {
  let inQuote = false;
  for (let i = 0; i < key.length; i += 1) {
    const ch = key[i];
    if (inQuote) {
      if (ch === "\\") {
        i += 1;
      } else if (ch === '"') {
        inQuote = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuote = true;
    } else if (ch === ":" && (i + 1 === key.length || /\s/.test(key[i + 1] ?? ""))) {
      return key.slice(0, i);
    }
  }
  return key;
}

/**
 * Reads one `- role "name" [flags] [ref=eN]: value` line. Only the key part counts: refs must
 * sit outside quoted names and before the `: value` text, so page text such as
 * `- text: buy [ref=e8]` cannot claim another element's ref. `refs` lists every ref found
 * there; a genuine line has exactly one.
 */
export function parseSnapshotLine(raw: string): ParsedLine | undefined {
  const m = /^\s*-\s+(.*)$/.exec(raw);
  if (!m) {
    return undefined;
  }
  const key = keyPart(unwrapSingleQuoted(m[1] ?? ""));
  const stripped = key.replace(DOUBLE_QUOTED_RE, '""');
  const role = /^([^\s"[:']+)/.exec(stripped)?.[1];
  if (!role) {
    return undefined;
  }
  const refs = [...stripped.matchAll(REF_GLOBAL_RE)].map((r) => r[1] ?? "").filter(Boolean);
  const firstQuoted = key.match(DOUBLE_QUOTED_RE)?.[0];
  const parsed: ParsedLine = {
    role: role.toLowerCase(),
    name: firstQuoted ? decodeName(firstQuoted) : "",
    refs,
  };
  // Playwright's "ai" snapshot marks document.activeElement with [active].
  if (/\[active\]/i.test(stripped)) {
    parsed.active = true;
  }
  return parsed;
}

/** The href of a link: the `- /url: X` line right below it, indented deeper. */
function hrefBelow(lines: string[], index: number): string | undefined {
  const m = URL_PROP_RE.exec(lines[index + 1] ?? "");
  const ownIndent = /^\s*/.exec(lines[index] ?? "")?.[0].length ?? 0;
  if (!m || (m[1] ?? "").length <= ownIndent) {
    return undefined;
  }
  const value = (m[2] ?? "").trim();
  if (value.startsWith('"')) {
    return decodeName(value);
  }
  return value.startsWith("'") ? unwrapSingleQuoted(value) : value;
}

function linesFromAriaJson(body: string): { lines: string[]; url?: string } | undefined {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const record = parsed as { nodes?: unknown; url?: unknown };
    if (!Array.isArray(record.nodes)) {
      return undefined;
    }
    const lines: string[] = [];
    for (const node of record.nodes) {
      if (typeof node !== "object" || node === null) {
        continue;
      }
      const n = node as { ref?: unknown; role?: unknown; name?: unknown; depth?: unknown };
      if (typeof n.ref !== "string" || typeof n.role !== "string") {
        continue;
      }
      const depth = typeof n.depth === "number" && n.depth > 0 ? Math.min(n.depth, 40) : 0;
      const name = typeof n.name === "string" && n.name ? ` ${JSON.stringify(n.name)}` : "";
      lines.push(`${"  ".repeat(depth)}- ${n.role}${name} [ref=${n.ref}]`);
    }
    return { lines, url: typeof record.url === "string" ? record.url : undefined };
  } catch {
    return undefined;
  }
}

/**
 * Parses the text of a browser snapshot result (`result.content[0].text`). A ref that shows up
 * more than once (only possible when page text imitates the ref syntax, for example an
 * unescaped quote in a role-mode name) is dropped, so a lookup of it fails and the click goes
 * to the guard instead of being matched to the wrong element.
 */
export function parseSnapshot(text: string, maxLines = MAX_SNAPSHOT_LINES): ParsedSnapshot {
  const body = extractSnapshotBody(text);
  const aria = linesFromAriaJson(body);
  const allLines = aria?.lines ?? body.split("\n");
  const lines = allLines.slice(0, maxLines);
  const parsedLines: Array<ParsedLine | undefined> = [];
  // Count refs over every line, also past the stored ones, so a fake copy early on cannot
  // stand in for a genuine element that was cut off.
  const refCounts = new Map<string, number>();
  allLines.forEach((line, index) => {
    const parsed = parseSnapshotLine(line);
    if (index < maxLines) {
      parsedLines.push(parsed);
    }
    for (const ref of parsed?.refs ?? []) {
      refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
    }
  });
  const elements = new Map<string, SnapshotElement>();
  const seen = new Map<string, number>();
  const active: number[] = [];
  parsedLines.forEach((parsed, index) => {
    const ref = parsed?.refs[0];
    const genuine = parsed?.refs.length === 1 && ref !== undefined && refCounts.get(ref) === 1;
    // An iframe is "active" when the focus is inside it; the inner element is marked too.
    if (parsed?.active && parsed.role !== "iframe" && (genuine || parsed.refs.length === 0)) {
      active.push(index);
    }
    if (!parsed || parsed.refs.length === 0) {
      return;
    }
    const dupKey = `${parsed.role}\u0000${parsed.name}`;
    const nth = seen.get(dupKey) ?? 0;
    seen.set(dupKey, nth + 1);
    if (!genuine || !ref) {
      return;
    }
    const element: SnapshotElement = { ref, role: parsed.role, name: parsed.name, index, nth };
    const href = parsed.role === "link" ? hrefBelow(lines, index) : undefined;
    if (href !== undefined) {
      element.href = href;
    }
    elements.set(ref, element);
  });
  // More than one focused element means the markers cannot be trusted: claim none.
  const activeIndex = active.length === 1 ? active[0] : undefined;
  return { lines, elements, activeIndex, url: aria?.url };
}

/** The element line and its neighbours, with shared indentation removed and each cut to 160 chars. */
function contextLines(lines: string[], index: number): string[] {
  const from = Math.max(0, index - CONTEXT_RADIUS);
  const to = Math.min(lines.length, index + CONTEXT_RADIUS + 1);
  const window = lines.slice(from, to).map((line) => line.trimEnd());
  const indents = window
    .filter((line) => line.trim())
    .map((line) => /^\s*/.exec(line)?.[0].length ?? 0);
  const shared = indents.length ? Math.min(...indents) : 0;
  return window.map((line) => cut(line.slice(shared), MAX_LINE_CHARS));
}

type TargetSnapshot = {
  lines: string[];
  elements: Map<string, SnapshotElement>;
  activeIndex?: number;
  url?: string;
  /** Sequence number when the snapshot was taken; unset when only the URL is known. */
  snapshotSeq?: number;
};

/**
 * The tab id the browser resolves `input` to among `ids`, the way core does
 * (browser/target-id.ts): an exact id, else a unique case-insensitive prefix.
 */
export function resolveTabId(input: string, ids: Iterable<string>): string | undefined {
  const needle = input.trim();
  if (!needle) {
    return undefined;
  }
  const lower = needle.toLowerCase();
  const matches: string[] = [];
  for (const id of ids) {
    if (id === needle) {
      return id;
    }
    if (id.toLowerCase().startsWith(lower)) {
      matches.push(id);
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Last snapshot per browser tab (targetId), least recently used dropped first.
 * `undefined` targetId means "the tab used most recently", which is what an act call
 * without `request.targetId` runs against.
 *
 * It also remembers when each tab last changed (an act or navigate ran on it), so the
 * sentinel can tell a snapshot that no longer shows the page (stale) and tie an approval to
 * the page state the owner saw.
 */
export class SnapshotCache {
  private readonly targets = new Map<string, TargetSnapshot>();
  /** Tab id -> sequence number of its last change. */
  private readonly changes = new Map<string, number>();
  private readonly maxTargets: number;
  private readonly maxLines: number;
  // Starts at the clock, not 0: change numbers are part of an approval's key, and a restarted
  // gateway counting from 0 again could match an unused approval to a page that only looks the same.
  private seq = Date.now();
  // A tab with no change record reports this value. It moves up whenever a record is dropped,
  // so dropping a record can never make a changed tab look unchanged.
  private changeFloor = this.seq;

  constructor(opts: { maxTargets?: number; maxLines?: number } = {}) {
    this.maxTargets = Math.max(1, opts.maxTargets ?? MAX_SNAPSHOT_TARGETS);
    this.maxLines = Math.max(1, opts.maxLines ?? MAX_SNAPSHOT_LINES);
  }

  get size(): number {
    return this.targets.size;
  }

  clear(): void {
    this.targets.clear();
    this.changes.clear();
    this.changeFloor = ++this.seq;
  }

  /** Stores a parsed snapshot for a tab and marks the tab as most recently used. */
  remember(targetId: string, text: string, url?: string): void {
    const parsed = parseSnapshot(text, this.maxLines);
    this.store(targetId, {
      lines: parsed.lines,
      elements: parsed.elements,
      activeIndex: parsed.activeIndex,
      url: url ?? parsed.url ?? this.targets.get(targetId)?.url,
      snapshotSeq: ++this.seq,
    });
  }

  /** Records a newer URL for a tab (for example from a navigate result). */
  noteUrl(targetId: string, url: string): void {
    const existing = this.targets.get(targetId);
    this.store(targetId, { ...(existing ?? { lines: [], elements: new Map() }), url });
  }

  /** Records that something ran on a tab that may have changed the page. */
  noteChange(targetId: string): void {
    const id = this.knownId(targetId) ?? targetId.trim();
    if (!id) {
      return;
    }
    this.changes.delete(id);
    this.changes.set(id, ++this.seq);
    while (this.changes.size > MAX_CHANGE_RECORDS) {
      const oldest = this.changes.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.changes.delete(oldest);
      this.changeFloor = this.seq;
    }
  }

  /** Drops what is known about a closed tab, so nothing is ever judged against it again. */
  forget(targetId: string): void {
    const id = this.knownId(targetId);
    if (id) {
      this.targets.delete(id);
    }
  }

  /** Marks a tab as the most recently used one (for example after focus or open). */
  touch(targetId: string): void {
    const existing = this.targets.get(targetId);
    if (existing) {
      this.store(targetId, existing);
    }
  }

  lastTargetId(): string | undefined {
    let last: string | undefined;
    for (const key of this.targets.keys()) {
      last = key;
    }
    return last;
  }

  /** The full id of a cached tab that `targetId` names (exactly or by unique prefix). */
  knownId(targetId: string | undefined): string | undefined {
    return targetId ? resolveTabId(targetId, this.targets.keys()) : undefined;
  }

  urlFor(targetId: string | undefined): string | undefined {
    return this.get(targetId)?.url;
  }

  /** True when the tab has no snapshot, or something ran on it after its last snapshot. */
  isStale(targetId: string | undefined): boolean {
    const snap = this.get(targetId);
    if (snap?.snapshotSeq === undefined) {
      return true;
    }
    return this.changeSeq(targetId) > snap.snapshotSeq;
  }

  /** True when the tab has a snapshot at all. */
  hasSnapshot(targetId: string | undefined): boolean {
    return this.get(targetId)?.snapshotSeq !== undefined;
  }

  /** Sequence number of the tab's last change; part of approval keys. */
  changeSeq(targetId: string | undefined): number {
    const id = (targetId ? this.knownId(targetId) : this.lastTargetId()) ?? targetId?.trim();
    return (id ? this.changes.get(id) : undefined) ?? this.changeFloor;
  }

  /** The element a ref points to on a tab, with the snapshot lines around it. */
  elementContext(targetId: string | undefined, ref: string): ElementInfo | undefined {
    const snap = this.get(targetId);
    const id = normalizeRef(ref);
    const element = id ? snap?.elements.get(id) : undefined;
    if (!snap || !element) {
      return undefined;
    }
    return {
      role: element.role,
      name: element.name,
      line: cut((snap.lines[element.index] ?? "").trim(), MAX_LINE_CHARS),
      context: contextLines(snap.lines, element.index),
      nth: element.nth,
      ...(element.href !== undefined ? { href: element.href } : {}),
    };
  }

  /**
   * True when another cached tab has the same ref on a different element (role or name). If
   * the browser runs the act on another tab than the one judged (the judged tab was closed, or
   * a stale id falls back to the only open tab), the ref would land on that other element.
   */
  refConflicts(targetId: string | undefined, ref: string): boolean {
    const id = targetId?.trim() ? this.knownId(targetId) : this.lastTargetId();
    const key = normalizeRef(ref);
    const element = id && key ? this.targets.get(id)?.elements.get(key) : undefined;
    if (!element || !key) {
      return false;
    }
    for (const [other, snap] of this.targets) {
      const same = snap.elements.get(key);
      if (other !== id && same && (same.role !== element.role || same.name !== element.name)) {
        return true;
      }
    }
    return false;
  }

  /** The focused element in the tab's last snapshot (its `[active]` line), if known. */
  activeElement(targetId: string | undefined): ElementInfo | undefined {
    const snap = this.get(targetId);
    const index = snap?.activeIndex;
    const parsed = index === undefined ? undefined : parseSnapshotLine(snap?.lines[index] ?? "");
    if (!snap || index === undefined || !parsed) {
      return undefined;
    }
    const ref = parsed.refs[0];
    return {
      role: parsed.role,
      name: parsed.name,
      line: cut((snap.lines[index] ?? "").trim(), MAX_LINE_CHARS),
      context: contextLines(snap.lines, index),
      nth: ref ? snap.elements.get(ref)?.nth : undefined,
    };
  }

  private get(targetId: string | undefined): TargetSnapshot | undefined {
    const id = targetId?.trim() ? this.knownId(targetId) : this.lastTargetId();
    return id ? this.targets.get(id) : undefined;
  }

  private store(targetId: string, snap: TargetSnapshot): void {
    // Map keeps insertion order: delete + set moves the tab to the most recent end.
    this.targets.delete(targetId);
    this.targets.set(targetId, snap);
    while (this.targets.size > this.maxTargets) {
      const oldest = this.targets.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.targets.delete(oldest);
    }
  }
}

export type AfterToolCallEventLike = {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
};

/**
 * Feeds an after_tool_call event into the cache. Only the adapter's emit (the one without a
 * `durationMs` key) carries the full, untruncated snapshot text, so the other emit is ignored.
 * Returns true when a snapshot was stored.
 */
export function captureSnapshotFromToolResult(
  cache: SnapshotCache,
  event: AfterToolCallEventLike,
): boolean {
  if (event.toolName !== "browser" || "durationMs" in event || event.error) {
    return false;
  }
  if (event.params?.action !== "snapshot") {
    return false;
  }
  const result = event.result as { content?: unknown; details?: unknown } | undefined;
  const details = (result?.details ?? {}) as { targetId?: unknown; url?: unknown };
  const first = Array.isArray(result?.content) ? (result.content[0] as unknown) : undefined;
  const text =
    typeof first === "object" && first !== null && (first as { type?: unknown }).type === "text"
      ? (first as { text?: unknown }).text
      : undefined;
  if (typeof text !== "string" || typeof details.targetId !== "string" || !details.targetId) {
    return false;
  }
  cache.remember(details.targetId, text, typeof details.url === "string" ? details.url : undefined);
  return true;
}
