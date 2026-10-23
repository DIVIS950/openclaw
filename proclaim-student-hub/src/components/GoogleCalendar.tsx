import { useEffect, useState } from "react";
import { useApp } from "../context.ts";
import {
  addToCalendar,
  calendarAdded,
  calendarAvailable,
  type CalendarItem,
  type CalEvent,
  upcomingEvents,
} from "../lib/googleCalendar.ts";
import { Icon } from "./Icon.tsx";

// "Add to Google Calendar" for a test or a piece of homework, and Today's
// "From your calendar" list. Both only show in the Claude app, where the
// Google Calendar connector can be reached.

function useCalendar(): boolean {
  const { data } = useApp();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (data.demo) {
      return;
    }
    let live = true;
    void calendarAvailable().then((v) => live && setOk(v));
    return () => {
      live = false;
    };
  }, [data.demo]);
  return ok;
}

export function CalendarButton({ item, small }: { item: CalendarItem; small?: boolean }) {
  const { toast } = useApp();
  const ok = useCalendar();
  const [added, setAdded] = useState(() => calendarAdded.has(item.key));
  const [busy, setBusy] = useState(false);
  if (!ok) {
    return null;
  }
  const cls = `btn${small ? " small" : ""}`;
  if (added) {
    const link = calendarAdded.link(item.key);
    return link ? (
      <a className={`${cls} ghost`} href={link} target="_blank" rel="noopener noreferrer">
        <Icon name="check" size={16} /> In Google Calendar
      </a>
    ) : (
      <span className={`${cls} ghost`} aria-disabled="true">
        <Icon name="check" size={16} /> In Google Calendar
      </span>
    );
  }
  const add = async () => {
    setBusy(true);
    try {
      await addToCalendar(item);
      setAdded(true);
      toast("Added to Google Calendar, with a reminder the evening before.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't add it to Google Calendar.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={cls} disabled={busy} onClick={() => void add()}>
      <Icon name={busy ? "loader" : "calendar"} size={16} className={busy ? "spin" : undefined} />
      {busy ? "Adding…" : "Add to Google Calendar"}
    </button>
  );
}

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });

/** "Today 16:00", "Tomorrow", "Thu 09:30" for an event start. */
export function whenLabel(e: CalEvent, now = new Date()): string {
  const [y, m, d] = e.start.slice(0, 10).split("-").map(Number);
  const day = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const name = diff <= 0 ? "Today" : diff === 1 ? "Tomorrow" : DAY.format(day);
  return e.allDay ? name : `${name} ${e.start.slice(11, 16)}`;
}

const REFRESH_MS = 10 * 60_000;
let cache: { at: number; events: CalEvent[] } | null = null;

/** Today: the next two days of the student's own calendar, hidden when there's nothing. */
export function CalendarCard() {
  const ok = useCalendar();
  const [events, setEvents] = useState<CalEvent[]>(() => cache?.events ?? []);
  useEffect(() => {
    if (!ok || (cache && Date.now() - cache.at < REFRESH_MS)) {
      return;
    }
    let live = true;
    upcomingEvents().then(
      (list) => {
        cache = { at: Date.now(), events: list };
        if (live) {
          setEvents(list);
        }
      },
      () => {
        // No calendar answer: the card just stays away.
      },
    );
    return () => {
      live = false;
    };
  }, [ok]);
  if (!ok || events.length === 0) {
    return null;
  }
  return (
    <section className="card rows today-due rise d4" aria-label="From your calendar">
      <div className="between" style={{ padding: "14px 16px 4px" }}>
        <h2 className="h2">From your calendar</h2>
      </div>
      {events.slice(0, 4).map((e) =>
        e.link ? (
          <a key={e.id} className="li" href={e.link} target="_blank" rel="noopener noreferrer">
            <span className="li-main li-title">{e.title}</span>
            <span className="s13 due-when">{whenLabel(e)}</span>
          </a>
        ) : (
          <div key={e.id} className="li">
            <span className="li-main li-title">{e.title}</span>
            <span className="s13 due-when">{whenLabel(e)}</span>
          </div>
        ),
      )}
    </section>
  );
}
