// Sends approval requests to the owner's phone: Telegram with Allow / Don't buttons, WhatsApp as
// plain text with the reply commands.
//
// The prompt text can reach the model: when the owner quote-replies to it ("why?"), the channel
// passes the quoted text on as reply context. So each chat only accepts the key it alone carries
// (see approvalKeyFromArgs): Telegram buttons send the entry id in their callback data, which
// is never part of the message text, and the Telegram text holds no key at all. WhatsApp
// prompts show the 6-digit code, which only counts when typed in WhatsApp, where the model
// cannot add buttons and its own sends are not read back as input.
// Type-only imports from OpenClaw: the runtime is passed in.
import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk";
import { clip } from "./text.js";
import type { OwnerChannel, PendingEntry, SentinelConfig } from "./types.js";

type Logger = OpenClawPluginApi["logger"];
type TelegramSendOptions = NonNullable<
  Parameters<PluginRuntime["channel"]["telegram"]["sendMessageTelegram"]>[2]
>;
export type TelegramButtons = NonNullable<TelegramSendOptions["buttons"]>;

/** How much of the detail block goes into the phone message. */
const DETAIL_MAX_CHARS = 700;

export type NotifyResult = { telegram: boolean; whatsapp: boolean };

/** How much of the summary the Allow button shows. */
const BUTTON_SUMMARY_MAX_CHARS = 40;

/** Cuts by code point, so an emoji is never split into an invalid half (Telegram rejects those). */
function clipCodePoints(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : value;
}

/** Entry ids are `crypto.randomUUID()` values; `/ok <id>` is 40 bytes, under Telegram's 64. */
const ENTRY_ID_RE = /^[0-9a-f-]{36}$/;
const CODE_RE = /^\d{6}$/;

/**
 * The approval key in an `/ok` or `/no` command from an owner chat, or undefined when the
 * argument is not the kind of key that chat's prompt carries: an entry id on Telegram (only a
 * button tap sends one), a 6-digit code on WhatsApp. A code the model saw in a quoted WhatsApp
 * prompt therefore cannot be put into a Telegram button it sends to the owner.
 */
export function approvalKeyFromArgs(
  channel: OwnerChannel,
  args: string | undefined,
): string | undefined {
  const key = (args ?? "").trim().split(/\s+/)[0] ?? "";
  return (channel === "telegram" ? ENTRY_ID_RE : CODE_RE).test(key) ? key : undefined;
}

/** The owner chats notifyOwner sends a request to (see ApprovalStore.create). */
export function notifyChannels(config: SentinelConfig): OwnerChannel[] {
  const channels: OwnerChannel[] = [];
  if (config.notify.telegram) {
    channels.push("telegram");
  }
  if (config.notify.whatsapp) {
    channels.push("whatsapp");
  }
  return channels;
}

/**
 * Inline buttons whose taps come back as the `/ok <id>` and `/no <id>` commands. They carry
 * the entry id, never the code. The Allow button names the action itself, so an edit of the
 * message text cannot change what it allows. One button per row, so the label stays readable.
 */
export function approvalButtons(entryId: string, summary: string): TelegramButtons {
  return [
    [
      {
        text: `✅ Allow: ${clipCodePoints(summary, BUTTON_SUMMARY_MAX_CHARS)}`,
        callback_data: `/ok ${entryId}`,
        style: "success",
      },
    ],
    [{ text: "❌ Don't", callback_data: `/no ${entryId}`, style: "danger" }],
  ];
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function expiryLine(ttlMinutes: number): string {
  const minutes = Math.max(1, Math.round(ttlMinutes));
  return `This request expires in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/**
 * Telegram message body. Sent with textMode "html" and every piece of page text escaped, so a
 * button name cannot add links or formatting to the prompt. No approval key: the buttons are
 * the only way to decide on Telegram.
 */
export function telegramApprovalText(entry: PendingEntry, ttlMinutes: number): string {
  const detail = clip(entry.detail.trim(), DETAIL_MAX_CHARS);
  const lines = [`<b>Muse wants to:</b> ${escapeHtml(entry.summary)}`];
  if (detail) {
    lines.push("", escapeHtml(detail));
  }
  lines.push("", "Tap a button below to allow or stop it.", expiryLine(ttlMinutes));
  return lines.join("\n");
}

/** WhatsApp message body (WhatsApp has no buttons in the plugin runtime). */
export function whatsappApprovalText(entry: PendingEntry, ttlMinutes: number): string {
  const detail = clip(entry.detail.trim(), DETAIL_MAX_CHARS);
  const lines = [`Muse wants to: ${entry.summary}`];
  if (detail) {
    lines.push("", detail);
  }
  lines.push(
    "",
    `Reply /ok ${entry.code} to allow or /no ${entry.code} to stop.`,
    expiryLine(ttlMinutes),
  );
  return lines.join("\n");
}

/**
 * Sends the approval request to every configured notify target. Never throws: a failed send is
 * logged (without the code) and reported as false, and the tool call stays blocked either way.
 */
export async function notifyOwner(
  runtime: PluginRuntime,
  logger: Logger,
  config: SentinelConfig,
  entry: PendingEntry,
): Promise<NotifyResult> {
  const result: NotifyResult = { telegram: false, whatsapp: false };
  const sends: Array<Promise<void>> = [];
  const telegramTo = config.notify.telegram;
  if (telegramTo) {
    sends.push(
      (async () => {
        try {
          await runtime.channel.telegram.sendMessageTelegram(
            telegramTo,
            telegramApprovalText(entry, config.approvalTtlMinutes),
            { textMode: "html", buttons: approvalButtons(entry.id, entry.summary) },
          );
          result.telegram = true;
        } catch (err) {
          logger.warn(
            `muse-sentinel: could not send the approval request ${entry.id} on Telegram: ${String(err)}`,
          );
        }
      })(),
    );
  }
  const whatsappTo = config.notify.whatsapp;
  if (whatsappTo) {
    sends.push(
      (async () => {
        try {
          await runtime.channel.whatsapp.sendMessageWhatsApp(
            whatsappTo,
            whatsappApprovalText(entry, config.approvalTtlMinutes),
            { verbose: false },
          );
          result.whatsapp = true;
        } catch (err) {
          logger.warn(
            `muse-sentinel: could not send the approval request ${entry.id} on WhatsApp: ${String(err)}`,
          );
        }
      })(),
    );
  }
  if (sends.length === 0) {
    logger.warn(
      `muse-sentinel: approval request ${entry.id} is waiting, but no Telegram or WhatsApp owner is configured; decide it on the desktop page or in Pineapple.`,
    );
  }
  await Promise.all(sends);
  return result;
}
