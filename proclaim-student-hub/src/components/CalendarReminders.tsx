import { useEffect, useMemo, useState } from "react";
import { useApp } from "../context.ts";
import {
  addAllToCalendar,
  calendarAuto,
  calendarPlan,
  notInCalendar,
  reportLine,
} from "../lib/calendarPlan.ts";
import { prepTests, tutoring } from "../lib/study.ts";
import type { Homework } from "../lib/types.ts";
import { useCalendar } from "./GoogleCalendar.tsx";
import { Icon } from "./Icon.tsx";

// More › Notifications: "Reminders through Google Calendar". One tap puts the
// open homework, tests and tutoring in the student's calendar with phone
// reminders; the switch keeps adding new work as it arrives. Only in the
// Claude app (the website has no calendar connector).

/** "3 homework · 1 test · 1 tutoring" from the items' keys. */
export function countsLine(keys: string[]): string {
  const n = (prefix: string) => keys.filter((k) => k.startsWith(prefix)).length;
  const hw = n("hw:");
  const tests = n("test:");
  const tutor = n("tutor:");
  return [
    hw > 0 ? `${hw} homework` : "",
    tests > 0 ? `${tests} ${tests === 1 ? "test" : "tests"}` : "",
    tutor > 0 ? `${tutor} tutoring` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const planFor = (homework: Homework[] | null) =>
  calendarPlan({
    homework: homework ?? [],
    tests: prepTests.all(),
    tutors: tutoring.tutors(),
  });

export function CalendarReminders({ fallback }: { fallback?: string }) {
  const { homework, toast } = useApp();
  const ok = useCalendar();
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(calendarAuto.get);
  // Bumped after adding, so the count reads the remembered list again.
  const [round, setRound] = useState(0);
  const todo = useMemo(() => notInCalendar(planFor(homework)), [homework, round]);

  if (!ok) {
    return fallback ? (
      <p className="card s13 rise d2" style={{ margin: 0, color: "var(--ink2)" }}>
        {fallback}
      </p>
    ) : null;
  }

  const add = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const report = await addAllToCalendar(todo);
      toast(reportLine(report));
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't reach Google Calendar.");
      return false;
    } finally {
      setBusy(false);
      setRound((r) => r + 1);
    }
  };

  const flip = async () => {
    if (auto) {
      calendarAuto.set(false);
      setAuto(false);
      return;
    }
    // Turning it on adds what's waiting now (this tap lets Claude ask about the calendar).
    if (todo.length === 0 || (await add())) {
      calendarAuto.set(true);
      setAuto(true);
    }
  };

  return (
    <section className="card stack cal-rem rise d2" aria-label="Reminders through Google Calendar">
      <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
        <span className="ic tone-blue" aria-hidden="true">
          <Icon name="calendar" size={18} />
        </span>
        <span className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <span style={{ fontWeight: 800 }}>Reminders through Google Calendar</span>
          <span className="muted s13">
            Your phone's Google Calendar app reminds you, even when the hub is closed.
          </span>
        </span>
      </div>
      {todo.length > 0 ? (
        <>
          <span className="s13" style={{ color: "var(--ink2)" }}>
            Not in your calendar yet: <b>{countsLine(todo.map((i) => i.key))}</b>
          </span>
          <button className="btn primary" disabled={busy} onClick={() => void add()}>
            <Icon
              name={busy ? "loader" : "calendar"}
              size={18}
              className={busy ? "spin" : undefined}
            />
            {busy ? "Adding…" : "Add to Google Calendar"}
          </button>
        </>
      ) : (
        <span className="cal-rem-done s13">
          <Icon name="check" size={16} /> Everything coming up is in your calendar.
        </span>
      )}
      <div className="nrow">
        <span className="stack" style={{ flex: 1, minWidth: 0, gap: 0 }}>
          <span style={{ fontWeight: 700 }}>Keep adding new work</span>
          <span className="muted s13">New homework and tests go in by themselves</span>
        </span>
        <button
          className={auto ? "sw on" : "sw"}
          role="switch"
          aria-checked={auto}
          aria-label="Keep adding new work"
          disabled={busy}
          onClick={() => void flip()}
        />
      </div>
      <span className="muted s12">
        Homework: 18:00 the evening before. Tests: two evenings before and the evening before.
        Tutoring: 15 minutes before, every week. Ticked-off work stays in the calendar until you
        delete it there.
      </span>
    </section>
  );
}

let lastAuto = 0;
/** At most one automatic run per half hour. */
const AUTO_GAP_MS = 30 * 60_000;

/** "Keep adding new work": while the app is open, new work goes into the calendar. */
export function useCalendarAuto(
  homework: Homework[] | null,
  demo: boolean,
  toast: (m: string) => void,
) {
  useEffect(() => {
    if (demo || homework === null || !calendarAuto.get() || Date.now() - lastAuto < AUTO_GAP_MS) {
      return;
    }
    const todo = notInCalendar(planFor(homework));
    if (todo.length === 0) {
      return;
    }
    lastAuto = Date.now();
    addAllToCalendar(todo).then(
      (r) => {
        if (r.added > 0) {
          toast(`${r.added} new in Google Calendar, with reminders.`);
        }
      },
      (err: unknown) => console.warn("Calendar reminders: not added this time", err),
    );
  }, [homework, demo, toast]);
}
