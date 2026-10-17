// Shared types and config defaults for Muse Sentinel.
// Pure module: no runtime imports from OpenClaw, so it stays unit-testable.

export type SentinelMode = "outbound" | "money" | "off";

export const SENTINEL_MODES: readonly SentinelMode[] = ["outbound", "money", "off"];
export const DEFAULT_GUARD_MODEL = "claude-haiku-5-5";
export const DEFAULT_APPROVAL_TTL_MINUTES = 30;
export const MAX_APPROVAL_TTL_MINUTES = 24 * 60;

/** Resolved plugin config. Owner ids are already normalized (see the normalizers below). */
export type SentinelConfig = {
  owners: { telegram: string[]; whatsapp: string[] };
  notify: { telegram?: string; whatsapp?: string };
  guardModel: string;
  approvalTtlMinutes: number;
  mode: SentinelMode;
};

/** The page element a browser action targets, resolved from the last snapshot of that tab. */
export type ElementInfo = {
  role: string;
  name: string;
  /** The snapshot line of the element, cut to 160 chars. */
  line: string;
  /** Up to 6 snapshot lines before and after the element (the element line included), each cut to 160 chars. */
  context: string[];
  /** Position among elements with the same role and name on that page (0 = first); stable across ref renumbering. */
  nth?: number;
  /** For a link: its href as the page wrote it (may be relative). */
  href?: string;
};

/** What the owner (and the guard model) is asked about. Never contains an approval code. */
export type ActionDescriptor = {
  tool: string;
  verb: string;
  /** One short plain-language line, e.g. `Click "Place order" on shop.example.com`. */
  summary: string;
  /** A few more lines of context for the owner; may contain untrusted page text. */
  detail: string;
  url?: string;
  element?: ElementInfo;
  text?: string;
  key?: string;
  /** sha256 of the meaningful parts, so a retry with a fresh snapshot ref still matches. */
  semanticKey: string;
};

/**
 * Result of classify().
 * - allow: run the tool call unchanged.
 * - deny: block with `reason` (already the full model-facing text).
 * - ask: needs the owner's approval.
 * - judge: ask the guard model first; its "ask" falls back to the owner.
 */
export type Decision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "ask"; action: ActionDescriptor }
  | { kind: "judge"; action: ActionDescriptor };

export type ApprovalStatus = "pending" | "approved" | "denied" | "used" | "expired";

/** The owner chats approval requests go to and decisions come from. */
export type OwnerChannel = "telegram" | "whatsapp";

export type PendingEntry = {
  id: string;
  /** 6 digits; only ever sent to the owner on WhatsApp, never to the HTTP state API. */
  code: string;
  /**
   * The owner chats the request was sent to. A chat decision counts only from one of these;
   * missing (an entry from an older state file) means none.
   */
  notifiedVia?: OwnerChannel[];
  sessionKey: string;
  tool: string;
  semanticKey: string;
  summary: string;
  detail: string;
  url?: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. Pending: request deadline. Approved: deadline to use the approval. */
  expiresAt: number;
  status: ApprovalStatus;
  decidedAt?: number;
  decidedVia?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Telegram user/chat id as the channel reports it: no `telegram:`/`tg:` prefix, lowercase. */
export function normalizeTelegramId(raw: unknown): string {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return "";
  }
  return String(raw)
    .trim()
    .replace(/^(?:telegram|tg):/i, "")
    .trim()
    .toLowerCase();
}

/**
 * WhatsApp number in E.164 form (`+420123456789`). Strips a `whatsapp:` prefix, spaces and
 * common separators, and the JID suffix of a personal chat. Group JIDs (`...@g.us`) are kept
 * lowercase as-is so they never equal an owner number.
 */
export function normalizeWhatsAppNumber(raw: unknown): string {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return "";
  }
  let value = String(raw)
    .trim()
    .replace(/^whatsapp:/i, "")
    .trim();
  if (!value) {
    return "";
  }
  if (/@g\.us$/i.test(value)) {
    return value.toLowerCase();
  }
  if (value.includes("@")) {
    // Personal JID: "420123456789:12@s.whatsapp.net" -> "420123456789".
    value = value.split("@")[0]?.split(":")[0] ?? "";
  }
  value = value.replace(/[\s\-().]/g, "");
  if (/^\d+$/.test(value)) {
    value = `+${value}`;
  }
  return value;
}

function normalizeList(raw: unknown, normalize: (value: unknown) => string): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const item of raw) {
    const value = normalize(item);
    if (value && !out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}

/**
 * Applies defaults to the raw `plugins.entries.muse-sentinel.config` value. The gateway
 * validates it against the manifest schema but never fills in defaults.
 */
export function resolveSentinelConfig(raw: unknown): SentinelConfig {
  const cfg = isRecord(raw) ? raw : {};
  const owners = isRecord(cfg.owners) ? cfg.owners : {};
  const notify = isRecord(cfg.notify) ? cfg.notify : {};
  const telegram = normalizeList(owners.telegram, normalizeTelegramId);
  const whatsapp = normalizeList(owners.whatsapp, normalizeWhatsAppNumber);
  const notifyTelegram = normalizeTelegramId(notify.telegram) || telegram[0];
  const notifyWhatsApp = normalizeWhatsAppNumber(notify.whatsapp) || whatsapp[0];
  const guardModel =
    typeof cfg.guardModel === "string" && cfg.guardModel.trim()
      ? cfg.guardModel.trim()
      : DEFAULT_GUARD_MODEL;
  const ttl =
    typeof cfg.approvalTtlMinutes === "number" && Number.isFinite(cfg.approvalTtlMinutes)
      ? Math.min(MAX_APPROVAL_TTL_MINUTES, Math.max(1, cfg.approvalTtlMinutes))
      : DEFAULT_APPROVAL_TTL_MINUTES;
  const mode = SENTINEL_MODES.find((m) => m === cfg.mode) ?? "outbound";
  return {
    owners: { telegram, whatsapp },
    notify: {
      ...(notifyTelegram ? { telegram: notifyTelegram } : {}),
      ...(notifyWhatsApp ? { whatsapp: notifyWhatsApp } : {}),
    },
    guardModel,
    approvalTtlMinutes: ttl,
    mode,
  };
}
