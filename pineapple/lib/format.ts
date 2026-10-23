// Display helpers, shared by server and client components. Always Prague time.
import { TIME_ZONE } from "./limits";

const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const time = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatClock(date: Date): string {
  return time.format(date);
}

export function formatCzk(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const text = rounded.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
  return `${text} CZK`;
}

/** "about 19:42", based on when the call ended plus the ETA the restaurant gave. */
export function etaClock(callEndedAt: string | null, etaMinutes: number | null): string | null {
  if (!callEndedAt || etaMinutes === null) return null;
  return formatClock(new Date(new Date(callEndedAt).getTime() + etaMinutes * 60_000));
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
