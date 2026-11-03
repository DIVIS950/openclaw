// Notifications (More › Notifications): reminders the app shows itself while
// it is open or running from the Home Screen. Nothing goes through a server,
// so a reminder only fires when the app gets a moment to run; on iPhone that
// means "Add to Home Screen" first (Safari only allows it for Home Screen apps).
import { WEEKDAYS, type Lesson } from "./aiFeatures.ts";
import type { Homework } from "./types.ts";

export type NotifyKind = "hw" | "due" | "lesson" | "tutor" | "brief" | "quiet";
export type NotifyPrefs = Record<NotifyKind, boolean>;

export const NOTIFY_DEFAULTS: NotifyPrefs = {
  hw: true,
  due: true,
  lesson: true,
  tutor: true,
  brief: true,
  quiet: false,
};

const PREFS = "psh.notify";
const SENT = "psh.notify.sent";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: lasts until the tab closes.
  }
}

export const notifyPrefs = {
  get: (): NotifyPrefs => ({ ...NOTIFY_DEFAULTS, ...read<Partial<NotifyPrefs>>(PREFS, {}) }),
  set: (p: NotifyPrefs) => write(PREFS, p),
};

export type Permission = "granted" | "denied" | "default" | "unsupported";

export function permission(): Permission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export async function askPermission(): Promise<Permission> {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.requestPermission();
}

/** One reminder: a stable id (so it fires once), a title and a line. */
export interface Reminder {
  id: string;
  title: string;
  body: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/**
 * What should go out right now, given the time and the student's day.
 * Pure, so it can be tested: the caller drops the ids already sent.
 */
export function dueReminders(
  now: Date,
  prefs: NotifyPrefs,
  input: {
    homework: Homework[];
    lessons: Lesson[];
    tutoring: { name: string; start: Date; meet?: string }[];
  },
): Reminder[] {
  const t = now.getHours() * 60 + now.getMinutes();
  const today = ymd(now);
  // Quiet hours: nothing from 21:30 to 07:00.
  if (prefs.quiet && (t >= 21 * 60 + 30 || t < 7 * 60)) {
    return [];
  }
  const out: Reminder[] = [];
  const dayIdx = (now.getDay() + 6) % 7;

  if (prefs.lesson) {
    for (const l of input.lessons) {
      if (WEEKDAYS.indexOf(l.day) !== dayIdx) {
        continue;
      }
      const until = minutesOf(l.start) - t;
      if (until > 0 && until <= 5) {
        out.push({
          id: `lesson:${today}:${l.start}`,
          title: `${l.subject} at ${l.start}`,
          body: l.room ? `Room ${l.room}. Starts in ${until} min.` : `Starts in ${until} min.`,
        });
      }
    }
  }

  if (prefs.tutor) {
    for (const s of input.tutoring) {
      const until = Math.round((s.start.getTime() - now.getTime()) / 60_000);
      if (until > 0 && until <= 15) {
        out.push({
          id: `tutor:${s.start.toISOString()}`,
          title: `Tutoring in ${until} min`,
          body: s.meet ? `${s.name} · tap to join the Meet.` : `${s.name}.`,
        });
      }
    }
  }

  const schoolDay = dayIdx < 5;
  if (prefs.brief && schoolDay && t >= 7 * 60 && t < 9 * 60) {
    const open = input.homework.filter((h) => !h.done && h.due && ymd(new Date(h.due)) === today);
    out.push({
      id: `brief:${today}`,
      title: "Your day",
      body:
        open.length > 0
          ? `Due today: ${open
              .slice(0, 2)
              .map((h) => h.title)
              .join(", ")}${open.length > 2 ? ` and ${open.length - 2} more` : ""}.`
          : "Nothing due today. Open the hub for your brief.",
    });
  }

  if (prefs.due && t >= 19 * 60 && t < 21 * 60 + 30) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const day = ymd(tomorrow);
    const due = input.homework.filter((h) => !h.done && h.due && ymd(new Date(h.due)) === day);
    for (const h of due) {
      out.push({
        id: `due:${h.id}:${day}`,
        title: "Due tomorrow",
        body: `${h.title}${h.course ? ` · ${h.course}` : ""}. Tap to start.`,
      });
    }
  }
  return out;
}

/** New Classroom work, as one reminder. */
export function newHomeworkReminder(added: Homework[]): Reminder | null {
  if (added.length === 0) {
    return null;
  }
  return {
    id: `hw:${added.map((h) => h.id).join(",")}`,
    title: added.length === 1 ? "New homework" : `${added.length} new homework`,
    body: added
      .slice(0, 3)
      .map((h) => (h.course ? `${h.title} · ${h.course}` : h.title))
      .join("\n"),
  };
}

/** Shows a reminder once (ids already shown are remembered for two days). */
export async function show(r: Reminder): Promise<boolean> {
  if (permission() !== "granted") {
    return false;
  }
  const sent = read<Record<string, number>>(SENT, {});
  if (sent[r.id]) {
    return false;
  }
  const cutoff = Date.now() - 2 * 86_400_000;
  const kept = Object.fromEntries(Object.entries(sent).filter(([, at]) => at > cutoff));
  write(SENT, { ...kept, [r.id]: Date.now() });
  const opts = { body: r.body, tag: r.id, icon: "icon-180.png", data: { url: location.href } };
  try {
    // Home Screen apps on iPhone can only show notifications through the service worker.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(r.title, opts);
      return true;
    }
    new Notification(r.title, opts);
    return true;
  } catch {
    return false;
  }
}

/**
 * Inside the Claude app the hub runs in a frame, and browsers don't let a page
 * in a frame ask for alerts: reminders go through Google Calendar there.
 */
export function framed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

const SEEN_HW = "psh.notify.seenHw";
/** More than this many "new" at once is a re-import, not news: remembered quietly. */
const TOO_MANY_NEW = 8;

/**
 * Homework this device hasn't seen before, such as tasks the hourly Classroom
 * check added while the app was closed. The first look on a device only
 * remembers what is there, so nobody gets their whole list as "new".
 */
export function newSinceLastLook(list: Homework[]): Homework[] {
  if (list.length === 0) {
    // An empty answer (signed out, nothing loaded): forget nothing.
    return [];
  }
  const seen = read<unknown>(SEEN_HW, null);
  write(
    SEEN_HW,
    list.map((h) => h.id),
  );
  if (!Array.isArray(seen)) {
    return [];
  }
  const known = new Set(seen);
  const fresh = list.filter((h) => !h.done && !known.has(h.id));
  return fresh.length > TOO_MANY_NEW ? [] : fresh;
}

/** Tasks this device added itself (Classroom emails, starter homework): not news next time. */
export function markSeen(added: Homework[]) {
  const seen = read<unknown>(SEEN_HW, null);
  if (Array.isArray(seen) && added.length > 0) {
    write(SEEN_HW, [...new Set([...seen, ...added.map((h) => h.id)])]);
  }
}

/** "Essay, Worksheet and 2 more" */
export function titlesLine(list: Homework[], max = 3): string {
  const names = list.slice(0, max).map((h) => h.title);
  return list.length > max ? `${names.join(", ")} and ${list.length - max} more` : names.join(", ");
}
