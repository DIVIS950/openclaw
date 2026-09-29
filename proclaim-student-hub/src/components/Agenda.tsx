import { useState } from "react";
import { agenda, upcomingEvents, type AgendaEvent } from "../lib/agenda.ts";
import { dayOf } from "../lib/study.ts";
import { subjectVars } from "../lib/subjects.ts";
import { AddAnythingButton } from "./AddAnything.tsx";
import { Icon } from "./Icon.tsx";

// The calendar list on the Timetable screen: trips, matches, deadlines and
// other one-off things added with "Add anything".

export function dateLabel(date: string, today: string): string {
  if (date === today) {
    return "Today";
  }
  const d = new Date(`${date}T12:00:00`);
  const t = new Date(`${today}T12:00:00`);
  t.setDate(t.getDate() + 1);
  if (d.toDateString() === t.toDateString()) {
    return "Tomorrow";
  }
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function AgendaList() {
  const today = dayOf(new Date());
  const [list, setList] = useState<AgendaEvent[]>(() => upcomingEvents(agenda.all(), today, 60));
  return (
    <section className="stack rise" style={{ gap: 8 }}>
      <div className="between">
        <h2 className="h2">Calendar</h2>
        <AddAnythingButton
          label="Add to the calendar"
          onSaved={() => setList(upcomingEvents(agenda.all(), today, 60))}
        />
      </div>
      {list.length === 0 ? (
        <div className="card empty">
          Nothing coming up. Tap + to paste a trip, match or deadline and the AI adds it.
        </div>
      ) : (
        <div className="list">
          {list.map((e) => (
            <div key={e.id} className="hw-row" style={subjectVars(e.subject)}>
              <span className="subject-dot" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="hw-title">{e.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {[dateLabel(e.date, today), e.time, e.subject].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button
                className="round"
                style={{ width: 32, height: 32 }}
                aria-label={`Delete "${e.title}"`}
                onClick={() => {
                  agenda.remove(e.id);
                  setList(upcomingEvents(agenda.all(), today, 60));
                }}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
