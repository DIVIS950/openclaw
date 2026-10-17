// Small text and hashing helpers shared by the pure Muse Sentinel modules.
import { createHash } from "node:crypto";

// Control characters (except tab and newline) and invisible format characters such as zero-width
// spaces and bidi overrides: they could make a summary shown to the owner read differently
// from what it does.
const INVISIBLE_RE = /(?![\t\n])[\p{Cc}\p{Cf}]/gu;

/** Removes invisible and control characters, keeping tabs and newlines. */
export function cleanText(value: string): string {
  return value.replace(INVISIBLE_RE, "");
}

/** Cuts text to `max` characters, ending with an ellipsis when cut. */
export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

/** One clean line: invisible characters removed, whitespace collapsed, cut to `max`. */
export function oneLine(value: string, max: number): string {
  return clip(cleanText(value).replace(/\s+/g, " ").trim(), max);
}

/** Lowercase, accents removed (ř -> r, é -> e), whitespace collapsed: for word matching. */
export function fold(value: string): string {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalize(value: unknown, depth: number): unknown {
  if (depth > 64) {
    return "[too deep]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalize(item, depth + 1)));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined && typeof item !== "function") {
        out[key] = canonicalize(item, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

/** JSON with object keys sorted and undefined values dropped, so equal data hashes equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, 0)) ?? "null";
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** sha256 of the canonical JSON of `value`. */
export function semanticHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A non-blank string (numbers are converted), else undefined. */
export function readString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() ? value : undefined;
  }
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

/** `"text"` on one line, cut to `max`. */
export function quote(value: string, max: number): string {
  return `"${oneLine(value, max)}"`;
}

/** Joins the present lines, removes invisible characters and cuts the result to 2000 chars. */
export function detailLines(lines: Array<string | undefined | false>): string {
  return clip(cleanText(lines.filter((line): line is string => Boolean(line)).join("\n")), 2000);
}

export function jsonPreview(value: unknown, max: number): string {
  try {
    return clip(JSON.stringify(value, null, 2) ?? "", max);
  } catch {
    return "(unreadable parameters)";
  }
}

function parseUrl(url: string | undefined): URL | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** The host for a summary line, or "the current page". */
export function hostOf(url: string | undefined): string {
  const parsed = parseUrl(url);
  return parsed?.host || (url ? oneLine(url, 60) : "the current page");
}

/** Host and path without query or fragment (for page-type checks such as checkout pages). */
export function hostPath(url: string | undefined): string | undefined {
  const parsed = parseUrl(url);
  if (!parsed) {
    return url ? clip(url, 300) : undefined;
  }
  return parsed.host ? `${parsed.host}${parsed.pathname}` : `${parsed.protocol}${parsed.pathname}`;
}

/**
 * The page part of an approval key: host, path, query and fragment. The query and fragment
 * often name the thing acted on (a draft, a cart, a recipient), so a different one needs a
 * new approval.
 */
export function pageKey(url: string | undefined): string | undefined {
  const parsed = parseUrl(url);
  if (!parsed) {
    return url;
  }
  const where = parsed.host ? parsed.host : parsed.protocol;
  return `${where}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Parses an absolute URL, or one relative to `base`. */
export function safeUrl(url: string, base?: string): URL | undefined {
  try {
    return new URL(url, base);
  } catch {
    return undefined;
  }
}
