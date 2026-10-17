// Wakes the agent after the owner decides. A plugin command cannot pass its message on to the
// agent, so this injects a synthetic inbound message into the session through the same path
// every channel uses (finalizeInboundContext + dispatchReplyWithBufferedBlockDispatcher), and
// sends the agent's replies back to the owner's chat.
// Type-only imports from OpenClaw: the runtime is passed in.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { OpenClawConfig, OpenClawPluginApi, ReplyPayload } from "openclaw/plugin-sdk";
import { asRecord, readString } from "./text.js";
import type { OwnerChannel, SentinelConfig } from "./types.js";
import { normalizeTelegramId, normalizeWhatsAppNumber } from "./types.js";

type ResumeApi = Pick<OpenClawPluginApi, "runtime" | "logger">;

/** Where the synthetic message comes from and where the agent's replies go. */
export type ResumeTarget = {
  channel: OwnerChannel;
  /** Telegram: `telegram:<chatId>`. WhatsApp: E.164. */
  to: string;
  accountId?: string;
  threadId?: string | number;
};

/** The shared Muse session (session.dmScope "main"). */
export const DEFAULT_SESSION_KEY = "agent:main:main";

export function approvedText(summary: string): string {
  return `[Muse Sentinel] The owner approved: ${summary}. Do exactly that now (same element, same text, same recipient), then continue the task.`;
}

export function deniedText(summary: string): string {
  return `[Muse Sentinel] The owner said no to: ${summary}. Do not do it. Briefly tell the owner what you will do instead, or stop.`;
}

export const GIVE_BACK_TEXT =
  "[Muse Sentinel] The owner gave the browser back. Continue the task if one was in progress.";

/** Whether a resume target is one of the configured owners (replies never go to anyone else). */
export function isOwnerAddress(target: ResumeTarget, owners: SentinelConfig["owners"]): boolean {
  if (target.channel === "telegram") {
    return owners.telegram.includes(normalizeTelegramId(target.to));
  }
  return owners.whatsapp.includes(normalizeWhatsAppNumber(target.to));
}

function agentIdFromSessionKey(sessionKey: string): string {
  return /^agent:([^:]+):/i.exec(sessionKey)?.[1]?.toLowerCase() ?? "main";
}

/**
 * The session's last external route (`lastChannel`/`lastTo` in the session store), when it is
 * Telegram or WhatsApp. Webchat turns never overwrite these fields, so this is the owner's chat.
 */
export function readLastRoute(api: ResumeApi, sessionKey: string): ResumeTarget | undefined {
  const cfg = api.runtime.config.loadConfig();
  const storePath = api.runtime.channel.session.resolveStorePath(cfg.session?.store, {
    agentId: agentIdFromSessionKey(sessionKey),
  });
  let store: Record<string, unknown>;
  try {
    store = asRecord(JSON.parse(fs.readFileSync(storePath, "utf8")) as unknown);
  } catch {
    return undefined;
  }
  const entry = asRecord(store[sessionKey] ?? store[sessionKey.toLowerCase()]);
  const channel = entry.lastChannel;
  const to = readString(entry.lastTo)?.trim();
  if ((channel !== "telegram" && channel !== "whatsapp") || !to) {
    return undefined;
  }
  const threadId = entry.lastThreadId;
  return {
    channel,
    to,
    accountId: readString(entry.lastAccountId),
    threadId: typeof threadId === "string" || typeof threadId === "number" ? threadId : undefined,
  };
}

function mediaOf(payload: ReplyPayload): string[] {
  const urls = [...(payload.mediaUrls ?? []), ...(payload.mediaUrl ? [payload.mediaUrl] : [])];
  return urls.map((url) => url.trim()).filter((url, i, all) => url && all.indexOf(url) === i);
}

async function deliverToOwner(
  api: ResumeApi,
  cfg: OpenClawConfig,
  target: ResumeTarget,
  payload: ReplyPayload,
): Promise<void> {
  // Reasoning blocks have no lane on Telegram or WhatsApp.
  if (payload.isReasoning) {
    return;
  }
  const text = payload.text?.trim() ?? "";
  const media = mediaOf(payload);
  const { channel, to, accountId } = target;
  // Split like core channel delivery: Telegram rejects a message over 4096 characters, and the
  // runtime send functions send the text in one piece.
  const chunker = api.runtime.channel.text;
  const parts = text
    ? chunker.chunkMarkdownText(text, chunker.resolveTextChunkLimit(cfg, channel, accountId))
    : [];
  if (channel === "telegram") {
    const threadId = typeof target.threadId === "number" ? target.threadId : undefined;
    const send = api.runtime.channel.telegram.sendMessageTelegram;
    for (const part of parts) {
      await send(to, part, { accountId, messageThreadId: threadId });
    }
    for (const mediaUrl of media) {
      await send(to, "", { accountId, messageThreadId: threadId, mediaUrl });
    }
    return;
  }
  const send = api.runtime.channel.whatsapp.sendMessageWhatsApp;
  for (const part of parts) {
    await send(to, part, { verbose: false, accountId });
  }
  for (const mediaUrl of media) {
    await send(to, "", { verbose: false, accountId, mediaUrl });
  }
}

/**
 * Injects `text` as a message from the owner into `sessionKey` and runs the agent. The message
 * can never run a command (CommandAuthorized: false); replies go to `target` only.
 */
export async function resumeSession(
  api: ResumeApi,
  params: { sessionKey: string; target: ResumeTarget; text: string },
): Promise<void> {
  const rt = api.runtime;
  const cfg = rt.config.loadConfig();
  const { target, text } = params;
  const ctx = rt.channel.reply.finalizeInboundContext({
    Body: text,
    BodyForAgent: text,
    RawBody: text,
    CommandBody: text,
    SessionKey: params.sessionKey,
    From: target.to,
    To: target.to,
    AccountId: target.accountId,
    MessageThreadId: target.threadId,
    ChatType: "direct",
    Provider: target.channel,
    Surface: target.channel,
    OriginatingChannel: target.channel,
    OriginatingTo: target.to,
    MessageSid: `muse-sentinel-${randomUUID()}`,
    // Injected text must never be able to run a command.
    CommandAuthorized: false,
  });
  await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx,
    cfg,
    dispatcherOptions: {
      deliver: async (payload) => {
        await deliverToOwner(api, cfg, target, payload);
      },
      onError: (err, info) => {
        api.logger.warn(`muse-sentinel: resume ${info.kind} reply failed: ${String(err)}`);
      },
    },
  });
}

/** Starts resumeSession without waiting for the agent run; failures are logged. */
export function resumeInBackground(
  api: ResumeApi,
  params: { sessionKey: string; target: ResumeTarget; text: string },
): Promise<void> {
  return resumeSession(api, params).catch((err: unknown) => {
    api.logger.warn(`muse-sentinel: could not resume the agent: ${String(err)}`);
  });
}
