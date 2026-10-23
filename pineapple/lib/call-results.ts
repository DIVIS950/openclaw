// Pure helpers that turn an ElevenLabs conversation into order results. Kept free of I/O for tests.
import type { Conversation } from "./elevenlabs";

export type TranscriptLine = { role: "agent" | "user"; message: string; timeSecs: number };

export type CallResults = {
  orderConfirmed: boolean | null;
  totalCzk: number | null;
  etaMinutes: number | null;
  notes: string | null;
  summary: string | null;
  callEndedAt: Date | null;
};

export function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "ano", "1"].includes(v)) return true;
    if (["false", "no", "ne", "0"].includes(v)) return false;
  }
  return null;
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  // "1 250 Kč" -> 1250, "45,5" -> 45.5, "about 40 min" -> 40
  const match = /-?\d+(?:\.\d+)?/.exec(value.replace(/[\s ]/g, "").replace(",", "."));
  return match ? Number(match[0]) : null;
}

function parseText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.toLowerCase() !== "null" ? text : null;
}

export function toTranscript(conversation: Pick<Conversation, "transcript">): TranscriptLine[] {
  return (conversation.transcript ?? [])
    .filter((line) => typeof line.message === "string" && line.message.trim() !== "")
    .map((line) => ({ role: line.role, message: (line.message ?? "").trim(), timeSecs: line.time_in_call_secs ?? 0 }));
}

export function extractResults(conversation: Conversation): CallResults {
  const data = conversation.analysis?.data_collection_results ?? {};
  const orderConfirmed = parseBoolean(data.order_confirmed?.value);
  const total = parseNumber(data.total_czk?.value);
  const eta = parseNumber(data.eta_minutes?.value);
  let notes = parseText(data.notes?.value);

  const restaurantSpoke = toTranscript(conversation).some((line) => line.role === "user");
  if (orderConfirmed !== true && !restaurantSpoke) {
    const reason = conversation.metadata?.termination_reason;
    const noAnswer = `Nobody talked on the line (no answer, busy or voicemail)${reason ? `: ${reason}` : ""}.`;
    notes = notes ? `${noAnswer} ${notes}` : noAnswer;
  }

  const { start_time_unix_secs: start, call_duration_secs: duration } = conversation.metadata ?? {};
  const callEndedAt =
    typeof start === "number" && typeof duration === "number" && start > 0 ? new Date((start + duration) * 1000) : null;

  return {
    orderConfirmed,
    totalCzk: total !== null && total >= 0 ? Math.round(total * 100) / 100 : null,
    etaMinutes: eta !== null && eta > 0 && eta < 24 * 60 ? Math.round(eta) : null,
    notes,
    summary: parseText(conversation.analysis?.transcript_summary),
    callEndedAt,
  };
}

export function describeFailure(conversation: Conversation): string {
  return (
    parseText(conversation.metadata?.error?.reason) ??
    parseText(conversation.metadata?.termination_reason) ??
    "The call failed on the ElevenLabs side."
  );
}
