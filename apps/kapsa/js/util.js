// Small helpers: haptics, clipboard, money and date formatting, calendar files.

import { getLang, locale } from "./i18n.js";

/** Light vibration where supported (Android). */
export function buzz(pattern = 15) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Nice-to-have only.
  }
}

/** Copy text, with a fallback for older browsers. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** "640 Kč", "€12.50". Whole amounts drop the decimals. */
export function money(amount, currency) {
  const whole = Math.abs(amount % 1) < 0.005;
  try {
    return new Intl.NumberFormat(locale(), {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Short money for chart labels: "1,2 tis. Kč" / "€1.2K". */
export function moneyShort(amount, currency) {
  try {
    return new Intl.NumberFormat(locale(), { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(amount);
  } catch {
    return money(amount, currency);
  }
}

export function formatNumber(n) {
  return new Intl.NumberFormat(locale()).format(n);
}

/** "31. 3. 2027" / "31 Mar 2027" from "YYYY-MM-DD". */
export function formatDate(iso) {
  if (!iso) {
    return "";
  }
  return new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
}

export function monthName(year, month, withYear = true) {
  return new Date(year, month, 15).toLocaleDateString(locale(), withYear ? { month: "long", year: "numeric" } : { month: "short" });
}

/** Local "YYYY-MM-DD" for a timestamp. */
export function isoDay(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "morning" | "afternoon" | "evening" for the greeting. */
export function greetingPart(t) {
  const h = new Date(t).getHours();
  if (h >= 4 && h < 11) {
    return "morning";
  }
  if (h >= 11 && h < 18) {
    return "afternoon";
  }
  return "evening";
}

/**
 * An all-day calendar event (with an alarm one day before at 9:00) as an .ics file,
 * so the phone's calendar reminds you. Works on iPhone, where web apps can't schedule alerts.
 * @param {{ title: string, date: string, note?: string, uid: string }} ev date is "YYYY-MM-DD"
 */
export function buildIcs(ev) {
  const day = ev.date.replace(/-/g, "");
  const next = isoDay(new Date(`${ev.date}T12:00:00`).getTime() + 86_400_000).replace(/-/g, "");
  const esc = (s) => String(s).replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\r?\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kapsa//CS",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${ev.uid}@kapsa`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${day}`,
    `DTEND;VALUE=DATE:${next}`,
    `SUMMARY:${esc(ev.title)}`,
    ev.note ? `DESCRIPTION:${esc(ev.note)}` : null,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(ev.title)}`,
    "TRIGGER:-PT15H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

/** Hand a file to the phone: share sheet when it can take files, else a download. */
export async function offerFile(name, type, text) {
  const file = new File([text], name, { type });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return true;
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export const isCzech = () => getLang() === "cs";
