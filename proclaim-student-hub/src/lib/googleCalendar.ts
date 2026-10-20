import { findKey } from "./canva.ts";
import { useCapability } from "./claudeRuntime.ts";

// Google Calendar through the student's claude.ai Google Calendar connector
// (the page never sees their Google login). Two things: a test or a piece of
// homework goes into the calendar with a reminder the evening before, and
// Today lists what else is on the calendar in the next two days. The website
// has no connector, so both stay hidden there.

const CALENDAR = "Google Calendar";
const ADDED_KEY = "psh.gcal.added";
/** Marks the events this app made, so Today doesn't list them twice. */
export const MADE_HERE = "Added by Student Hub.";

export interface CalendarItem {
  /** Remembers it was added: "test:<id>" or "hw:<id>". */
  key: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  details?: string;
  /** Minutes before the start of the day for each phone reminder. */
  reminders: number[];
}

export interface CalEvent {
  id: string;
  title: string;
  /** Local start: "YYYY-MM-DDTHH:MM" for timed events, "YYYY-MM-DD" for all-day. */
  start: string;
  allDay: boolean;
  link: string;
  madeHere: boolean;
}

/** 18:00 the evening before an all-day event (it starts at midnight). */
export const EVENING_BEFORE = 6 * 60;
/** 18:00 two evenings before (30 hours before that midnight). */
export const TWO_EVENINGS_BEFORE = 30 * 60;

const pad = (n: number) => String(n).padStart(2, "0");

/** Local time as the connector wants it: no offset, no "Z". */
export function localStamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
  );
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

/** The connector's create_event input for one all-day item. */
export function eventInput(item: CalendarItem) {
  return {
    summary: item.title.slice(0, 200),
    allDay: true,
    startTime: `${item.date}T00:00:00`,
    endTime: `${nextDay(item.date)}T00:00:00`,
    description: [item.details?.trim(), MADE_HERE].filter(Boolean).join("\n\n"),
    overrideReminders: item.reminders.map((minutes) => ({ method: "popup", minutes })),
  };
}

type Added = Record<string, { at: string; link: string }>;

function readAdded(): Added {
  try {
    const v = JSON.parse(localStorage.getItem(ADDED_KEY) ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Added) : {};
  } catch {
    return {};
  }
}

export const calendarAdded = {
  has(key: string): boolean {
    return key in readAdded();
  },
  link(key: string): string {
    return readAdded()[key]?.link ?? "";
  },
  mark(key: string, link: string) {
    try {
      localStorage.setItem(
        ADDED_KEY,
        JSON.stringify({ ...readAdded(), [key]: { at: new Date().toISOString(), link } }),
      );
    } catch {
      // Not remembered: the button offers it again next time.
    }
  },
};

/** True where the calendar can be reached (the Claude app), false on the website. */
export async function calendarAvailable(): Promise<boolean> {
  return (await useCapability("mcp")) !== null;
}

function calendarError(err: unknown): Error {
  return new Error(
    "Couldn't reach Google Calendar. Check the Google Calendar connector is connected on claude.ai.",
    { cause: err },
  );
}

/** Adds one item; returns the event's link ("" if the reply had none). Must follow a tap. */
export async function addToCalendar(item: CalendarItem): Promise<string> {
  const mcp = await useCapability("mcp");
  if (!mcp) {
    throw new Error("Open Student Hub in the Claude app to add things to Google Calendar.");
  }
  let payload: unknown;
  try {
    ({ payload } = await mcp.callTool(CALENDAR, "create_event", eventInput(item)));
  } catch (err) {
    throw calendarError(err);
  }
  const link = findKey(payload, "htmlLink");
  const url = typeof link === "string" && link.startsWith("https://") ? link : "";
  calendarAdded.mark(item.key, url);
  return url;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** "2026-10-21T09:00:00+02:00" → "2026-10-21T09:00" in this device's time. */
function localStart(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return localStamp(d).slice(0, 16);
}

function readStart(v: unknown): { start: string; allDay: boolean } {
  if (typeof v === "string") {
    const start = localStart(v);
    return { start, allDay: start.length === 10 };
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (str(o.dateTime)) {
      return { start: localStart(str(o.dateTime)), allDay: false };
    }
    if (str(o.date)) {
      return { start: str(o.date).slice(0, 10), allDay: true };
    }
  }
  return { start: "", allDay: false };
}

/**
 * Events from a list_events reply, whatever the list is called ("items" in
 * Google's API, "events" in some connectors). Unknown shapes give [].
 */
export function readEvents(payload: unknown): CalEvent[] {
  const lists: unknown[][] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      if (v.some((e) => e && typeof e === "object" && "summary" in e && "start" in e)) {
        lists.push(v);
        return;
      }
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk(payload);
  return lists
    .flat()
    .flatMap((e): CalEvent[] => {
      if (!e || typeof e !== "object") {
        return [];
      }
      const o = e as Record<string, unknown>;
      if (str(o.status) === "cancelled") {
        return [];
      }
      const { start, allDay } = readStart(o.start ?? o.startTime);
      const title = str(o.summary).trim() || "(No title)";
      if (!start) {
        return [];
      }
      return [
        {
          id: str(o.id) || `${start}-${title}`,
          title,
          start,
          allDay,
          link: str(o.htmlLink).startsWith("https://") ? str(o.htmlLink) : "",
          madeHere: str(o.description).includes(MADE_HERE),
        },
      ];
    })
    .toSorted((a, b) => a.start.localeCompare(b.start));
}

/** The next `days` days of the student's own calendar (not the events this app added). */
export async function upcomingEvents(now = new Date(), days = 2): Promise<CalEvent[]> {
  const mcp = await useCapability("mcp");
  if (!mcp) {
    return [];
  }
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days + 1);
  let payload: unknown;
  try {
    ({ payload } = await mcp.callTool(CALENDAR, "list_events", {
      startTime: localStamp(now),
      endTime: localStamp(end),
      orderBy: "startTime",
      pageSize: 20,
    }));
  } catch (err) {
    throw calendarError(err);
  }
  return readEvents(payload).filter((e) => !e.madeHere);
}
