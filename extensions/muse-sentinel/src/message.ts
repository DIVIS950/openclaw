// Classifies `message` tool calls: anything that reaches someone other than the owner needs approval.
// No runtime imports from OpenClaw; only node builtins (to fingerprint local attachments).
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clip,
  detailLines,
  jsonPreview,
  oneLine,
  quote,
  readString,
  semanticHash,
} from "./text.js";
import type { ActionDescriptor, Decision, SentinelConfig } from "./types.js";
import { normalizeTelegramId, normalizeWhatsAppNumber } from "./types.js";

const ALLOW: Decision = { kind: "allow" };

export const MESSAGE_READ_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  "reactions",
  "list-pins",
  "permissions",
  "thread-list",
  "search",
  "sticker-search",
  "member-info",
  "role-info",
  "emoji-list",
  "channel-info",
  "channel-list",
  "voice-status",
  "event-list",
]);

/**
 * Actions that change or remove a message already in a chat. They always ask, even in the
 * owner's own chat: that chat holds the approval requests, and an edit that keeps the Telegram
 * buttons could relabel what "Allow" approves.
 */
export const MESSAGE_MODIFY_ACTIONS: ReadonlySet<string> = new Set([
  "edit",
  "delete",
  "unsend",
  "pin",
  "unpin",
]);

// Actions whose missing target is filled with the current chat (target mode "to" in core's
// message-action-spec.ts). Other actions without a target act on something else entirely.
const MESSAGE_IMPLICIT_TARGET_ACTIONS: ReadonlySet<string> = new Set([
  "send",
  "poll",
  "react",
  "read",
  "edit",
  "unsend",
  "reply",
  "sendWithEffect",
  "renameGroup",
  "setGroupIcon",
  "addParticipant",
  "removeParticipant",
  "leaveGroup",
  "sendAttachment",
  "delete",
  "pin",
  "unpin",
  "thread-create",
  "thread-reply",
  "sticker",
  "topic-create",
]);
const MESSAGE_TARGET_KEYS = ["target", "to", "channelId", "chatId", "chatGuid", "chatIdentifier"];
const MESSAGE_SEND_ACTIONS = new Set([
  "send",
  "reply",
  "sendWithEffect",
  "sendAttachment",
  "thread-reply",
  "sticker",
]);
const MODIFY_VERBS: Record<string, string> = {
  edit: "Edit",
  delete: "Delete",
  unsend: "Unsend",
  pin: "Pin",
  unpin: "Unpin",
};
const OWNER_CHANNELS: ReadonlySet<string> = new Set(["telegram", "whatsapp"]);
const CHANNEL_LABELS: Record<string, string> = { telegram: "Telegram", whatsapp: "WhatsApp" };

function collectMessageTargets(params: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (value: unknown) => {
    const text = readString(value)?.trim();
    if (text && !out.includes(text)) {
      out.push(text);
    }
  };
  for (const key of MESSAGE_TARGET_KEYS) {
    add(params[key]);
  }
  if (Array.isArray(params.targets)) {
    params.targets.forEach(add);
  }
  return out;
}

/** Whether a message target is one of the owners on the channel the message would use. */
export function isOwnerTarget(
  raw: string,
  channel: string | undefined,
  owners: SentinelConfig["owners"],
): boolean {
  const value = raw.trim();
  const tgPrefixed = /^(?:telegram|tg):/i.test(value);
  const waPrefixed = /^whatsapp:/i.test(value);
  if (!value) {
    return false;
  }
  if (channel === "telegram" || (!channel && tgPrefixed)) {
    return !waPrefixed && owners.telegram.includes(normalizeTelegramId(value));
  }
  if (channel === "whatsapp" || (!channel && waPrefixed)) {
    return !tgPrefixed && owners.whatsapp.includes(normalizeWhatsAppNumber(value));
  }
  if (channel) {
    return false;
  }
  // No channel: core uses the current chat's channel. Accept the plain forms owners use.
  if (!/^\+?\d[\d\s\-()]*$/.test(value)) {
    return false;
  }
  if (!value.startsWith("+") && owners.telegram.includes(normalizeTelegramId(value))) {
    return true;
  }
  return owners.whatsapp.includes(normalizeWhatsAppNumber(value));
}

function normalizeTarget(target: string, channel: string | undefined): string {
  if (channel === "telegram" || /^(?:telegram|tg):/i.test(target)) {
    return `telegram:${normalizeTelegramId(target)}`;
  }
  if (channel === "whatsapp" || /^whatsapp:/i.test(target)) {
    return `whatsapp:${normalizeWhatsAppNumber(target)}`;
  }
  return target.trim().toLowerCase();
}

// ---------------------------------------------------------------- attachment fingerprints

/**
 * Key under which withMediaDigests() adds the attachment fingerprints to a copy of the params.
 * The copy is only classified; the tool runs with the original params.
 */
export const MEDIA_DIGEST_KEY = "mediaSha256";
/** Larger files are never fingerprinted, so no approval can match a send of them. */
export const MAX_MEDIA_DIGEST_BYTES = 256 * 1024 * 1024;
const MEDIA_DIGEST_TIMEOUT_MS = 20_000;
const MAX_MEDIA_REFS = 32;
const MEDIA_PARAM_KEYS = ["media", "path", "filePath"];
// Core also attaches files named on `MEDIA:` lines of the text (src/media/parse.ts).
const MEDIA_TEXT_KEYS = ["message", "caption"];
const MEDIA_DIRECTIVE_RE = /MEDIA:\s*`?([^\n]+)`?/gi;
// Read errors core hits too, so the send fails anyway: a stable marker keeps a retry matching.
const UNSENDABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  "ENOENT",
  "ENOTDIR",
  "ENAMETOOLONG",
  "EISDIR",
  "ELOOP",
  "EACCES",
  "EPERM",
]);
const OPEN_FLAGS =
  fsConstants.O_RDONLY |
  // A FIFO would block the open forever; non-blocking open plus the isFile() check rejects it.
  ("O_NONBLOCK" in fsConstants ? fsConstants.O_NONBLOCK : 0) |
  // Core refuses to send a symlink (src/infra/fs-safe.ts), so do not follow one either.
  ("O_NOFOLLOW" in fsConstants ? fsConstants.O_NOFOLLOW : 0);

function cleanMediaToken(raw: string): string {
  return raw
    .trim()
    .replace(/^[`"'[{(]+/, "")
    .replace(/[`"'\\})\],]+$/, "");
}

/** A token core's MEDIA: parser can take as a path on its own (not a stray word). */
function looksLikePath(token: string): boolean {
  return /^(?:\/|\.\.?\/|~|file:\/\/)/.test(token) || token.includes("/") || token.includes("\\");
}

/**
 * Local files a message call may attach: `media`, `path`, `filePath`, and `MEDIA:` lines in the
 * text. Generous on purpose: an extra reference only adds to the approval key.
 */
export function localMediaRefs(params: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const add = (raw: string | undefined) => {
    const value = raw?.trim().replace(/^MEDIA\s*:\s*/i, "");
    if (value && !/^https?:\/\//i.test(value) && !refs.includes(value)) {
      refs.push(value);
    }
  };
  for (const key of MEDIA_PARAM_KEYS) {
    add(readString(params[key]));
  }
  for (const key of MEDIA_TEXT_KEYS) {
    // Core turns a literal "\n" in the message into a newline before it parses MEDIA: lines.
    const text = readString(params[key])?.replaceAll("\\n", "\n");
    for (const match of text?.matchAll(MEDIA_DIRECTIVE_RE) ?? []) {
      const payload = match[1] ?? "";
      add(cleanMediaToken(payload));
      for (const part of payload.split(/\s+/)) {
        const token = cleanMediaToken(part);
        if (looksLikePath(token)) {
          add(token);
        }
      }
    }
  }
  return refs;
}

function homeDir(): string {
  const home = process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || os.homedir();
  const explicit = process.env.OPENCLAW_HOME?.trim();
  return explicit ? explicit.replace(/^~(?=$|[\\/])/, home) : home;
}

/** The file core would read for this reference (see loadWebMedia in src/web/media.ts). */
function resolveLocalMediaPath(ref: string): string {
  if (ref.startsWith("file://")) {
    return fileURLToPath(ref);
  }
  if (/^~(?=$|[\\/])/.test(ref)) {
    return path.resolve(ref.replace(/^~/, homeDir()));
  }
  return path.resolve(ref);
}

function neverMatches(why: string): string {
  return `${why}:${randomUUID()}`;
}

async function sha256OfFile(filePath: string, maxBytes: number): Promise<string> {
  const handle = await fs.open(filePath, OPEN_FLAGS);
  try {
    if (!(await handle.stat()).isFile()) {
      return "not-a-file";
    }
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(1024 * 1024);
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) {
        return `sha256:${hash.digest("hex")}`;
      }
      total += bytesRead;
      if (total > maxBytes) {
        return neverMatches("too-large");
      }
      hash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
}

/** Fingerprint of one attachment reference; never throws. */
async function digestLocalMedia(ref: string, maxBytes: number, timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const filePath = resolveLocalMediaPath(ref);
    return await Promise.race([
      sha256OfFile(filePath, maxBytes),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(neverMatches("timeout")), timeoutMs);
      }),
    ]);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code && UNSENDABLE_ERROR_CODES.has(code)) {
      return `unreadable:${code}`;
    }
    // Anything else (an I/O error, a bad file:// URL): no approval can match this call.
    return neverMatches("unhashed");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns a copy of `params` with a fingerprint of every local attachment under
 * MEDIA_DIGEST_KEY, so an approval binds the file's bytes and not only its path: the workspace
 * file can be rewritten (write/edit are allowed) between the approval and the retry. Call it on
 * every message call, since the file is read again when the message is sent.
 */
export async function withMediaDigests(
  params: Record<string, unknown>,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const copy: Record<string, unknown> = { ...params };
  // Never keep a value the model put there itself.
  delete copy[MEDIA_DIGEST_KEY];
  const refs = localMediaRefs(params);
  if (refs.length === 0) {
    return copy;
  }
  const maxBytes = opts.maxBytes ?? MAX_MEDIA_DIGEST_BYTES;
  const timeoutMs = opts.timeoutMs ?? MEDIA_DIGEST_TIMEOUT_MS;
  const digests: Record<string, string> = {};
  const checked = refs.slice(0, MAX_MEDIA_REFS);
  const values = await Promise.all(
    checked.map((ref) => digestLocalMedia(ref, maxBytes, timeoutMs)),
  );
  checked.forEach((ref, index) => {
    digests[ref] = values[index] ?? neverMatches("unhashed");
  });
  if (refs.length > checked.length) {
    digests["(more attachments)"] = neverMatches("too-many");
  }
  copy[MEDIA_DIGEST_KEY] = digests;
  return copy;
}

// ---------------------------------------------------------------- classification

function describeMessage(
  action: string,
  channel: string | undefined,
  targets: string[],
  params: Record<string, unknown>,
): ActionDescriptor {
  const label = channel ? (CHANNEL_LABELS[channel] ?? channel) : "chat";
  const text =
    readString(params.message) ??
    readString(params.caption) ??
    readString(params.pollQuestion) ??
    "";
  const media = readString(params.media) ?? readString(params.path) ?? readString(params.filePath);
  const to = targets.length ? oneLine(targets.join(", "), 80) : "the current chat";
  const what = text ? `: ${quote(text, 120)}` : media ? ` with ${oneLine(media, 60)}` : "";
  const modifyVerb = MODIFY_VERBS[action];
  let summary: string;
  if (MESSAGE_SEND_ACTIONS.has(action)) {
    summary = `Send a ${label} message to ${to}${what}`;
  } else if (action === "broadcast") {
    summary = `Broadcast a ${label} message to ${to}${what}`;
  } else if (action === "poll") {
    summary = `Post a ${label} poll to ${to}${what}`;
  } else if (modifyVerb) {
    const newText = action === "edit" && text ? ` to ${quote(text, 120)}` : "";
    summary = `${modifyVerb} a ${label} message in ${to}${newText}`;
  } else {
    summary = `${label === "chat" ? "Chat" : label} action "${oneLine(action, 40)}" for ${to}${what}`;
  }
  const rest: Record<string, unknown> = { ...params };
  for (const key of ["action", "channel", "targets", "message", ...MESSAGE_TARGET_KEYS]) {
    delete rest[key];
  }
  // The base64 attachment and the file fingerprints are hashed into the key but never shown.
  const shownRest: Record<string, unknown> = { ...rest };
  delete shownRest.buffer;
  delete shownRest[MEDIA_DIGEST_KEY];
  return {
    tool: "message",
    verb: action,
    summary: oneLine(summary, 240),
    detail: detailLines([
      `Message action: ${action}`,
      `Channel: ${channel ?? "(the current chat's channel)"}`,
      `To: ${targets.length ? targets.join(", ") : "(the current chat)"}`,
      text && `Text: ${clip(text, 1500)}`,
      media && `Attachment: ${media}`,
      Object.keys(shownRest).length > 0 && `Other parameters: ${jsonPreview(shownRest, 400)}`,
      modifyVerb &&
        "This changes a message that is already in the chat, which could be one of Muse's approval requests.",
    ]),
    text: text || undefined,
    semanticKey: semanticHash({
      tool: "message",
      action,
      channel: channel ?? null,
      targets: targets.map((t) => normalizeTarget(t, channel)).toSorted(),
      message: text,
      rest,
    }),
  };
}

/** Whether an action descriptor is an edit, delete, unsend, pin or unpin of a chat message. */
export function isMessageModifyAction(action: ActionDescriptor): boolean {
  return action.tool === "message" && MESSAGE_MODIFY_ACTIONS.has(action.verb);
}

/**
 * Classifies a `message` tool call: read-only actions and messages to the owner go ahead.
 * Pass the params through withMediaDigests() first so the key covers attached files.
 */
export function classifyMessage(params: Record<string, unknown>, config: SentinelConfig): Decision {
  const action = readString(params.action)?.trim() ?? "send";
  if (MESSAGE_READ_ONLY_ACTIONS.has(action)) {
    return ALLOW;
  }
  const channel = readString(params.channel)?.trim().toLowerCase();
  const targets = collectMessageTargets(params);
  const askOwner = (): Decision => ({
    kind: "ask",
    action: describeMessage(action, channel, targets, params),
  });
  if (MESSAGE_MODIFY_ACTIONS.has(action)) {
    // Whatever the target: the owner's chat is where approval requests live.
    return askOwner();
  }
  if (targets.length === 0) {
    // No target means "this chat", which is the owner's under the allowlist DM policies.
    const replyHere =
      MESSAGE_IMPLICIT_TARGET_ACTIONS.has(action) && (!channel || OWNER_CHANNELS.has(channel));
    return replyHere ? ALLOW : askOwner();
  }
  // Broadcast without one owner channel fans out to every configured channel.
  if (action === "broadcast" && !(channel && OWNER_CHANNELS.has(channel))) {
    return askOwner();
  }
  return targets.every((t) => isOwnerTarget(t, channel, config.owners)) ? ALLOW : askOwner();
}
