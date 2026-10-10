import { useEffect, useState } from "react";
import { AgendaList } from "../components/Agenda.tsx";
import { Icon } from "../components/Icon.tsx";
import { BackButton } from "../components/BackButton.tsx";
import { ImportSheet } from "../components/ImportSheet.tsx";
import { useAiContext, useApp } from "../context.ts";
import { WEEKDAYS, type Lesson, type Weekday } from "../lib/aiFeatures.ts";
import { timetable } from "../lib/store.ts";
import { subjectTone } from "../lib/subjects.ts";
import { lessonsOn, nowAndNext, schoolDays, weekdayOf } from "../lib/timetable.ts";
import type { Homework } from "../lib/types.ts";

const DAY_NAMES: Record<Weekday, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

/** Re-renders every 30 seconds so "now" and the progress bar stay current. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const inMinutes = (n: number) =>
  n < 60 ? `${n} min` : `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ""}`;

function homeworkFor(lesson: Lesson, homework: Homework[]): Homework[] {
  const key = lesson.subject.toLowerCase().split(/\s+/)[0];
  return key.length < 3
    ? []
    : homework.filter((h) => !h.done && `${h.course} ${h.title}`.toLowerCase().includes(key));
}

/** Monday of the week `offset` weeks from now. */
function mondayOf(now: Date, offset: number): Date {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
  return d;
}

/** "6 – 10 October" or "29 Sept – 3 Oct" for the school week starting on `monday`. */
function weekLabel(monday: Date): string {
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "long" });
  return monday.getMonth() === friday.getMonth()
    ? `${monday.getDate()} – ${friday.getDate()} ${month(friday)}`
    : `${monday.getDate()} ${monday.toLocaleDateString("en-GB", { month: "short" })} – ${friday.getDate()} ${friday.toLocaleDateString("en-GB", { month: "short" })}`;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Breaks between lessons: a gap of 20 minutes or more; around midday it is lunch. */
type Row = { kind: "lesson"; lesson: Lesson } | { kind: "break"; label: string };
function withBreaks(list: Lesson[]): Row[] {
  const rows: Row[] = [];
  list.forEach((l, i) => {
    const prev = list[i - 1];
    if (prev?.end) {
      const gap = toMinutes(l.start) - toMinutes(prev.end);
      if (gap >= 20) {
        const lunch = toMinutes(prev.end) >= 11 * 60 + 30 && toMinutes(prev.end) <= 14 * 60;
        rows.push({ kind: "break", label: `${lunch ? "Lunch" : "Break"} · ${prev.end}` });
      }
    }
    rows.push({ kind: "lesson", lesson: l });
  });
  return rows;
}

export function Timetable() {
  const { ai, homework } = useApp();
  const now = useNow();
  const [lessons, setLessons] = useState<Lesson[]>(timetable.get);
  const days = schoolDays(lessons);
  const today = weekdayOf(now);
  // At the weekend this week is all over: open on next week's first school day.
  const schoolToday = days.includes(today);
  const [day, setDay] = useState<Weekday>(schoolToday ? today : (days[0] ?? "Mon"));
  const [week, setWeek] = useState(schoolToday ? 0 : 1);
  const [editing, setEditing] = useState<{ lesson: Lesson; index: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const { current, left, next } = nowAndNext(lessons, now);
  const list = lessonsOn(lessons, day);
  const monday = mondayOf(now, week);
  const thisWeek = week === 0;
  useAiContext(
    `Timetable. ${DAY_NAMES[day]}: ` +
      (list
        .map((l) => `${l.start}-${l.end} ${l.subject}${l.room ? ` in ${l.room}` : ""}`)
        .join("; ") || "no lessons"),
  );

  const save = (next: Lesson[]) => {
    setLessons(next);
    timetable.save(next);
  };

  const dateOf = (d: Weekday) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + WEEKDAYS.indexOf(d));
    return date.getDate();
  };

  // A lesson is past once it has ended today, or on an earlier day of this week.
  const state = (l: Lesson): "now" | "next" | "past" | "" => {
    if (!thisWeek) {
      return "";
    }
    if (day === today) {
      if (current === l) {
        return "now";
      }
      if (next === l) {
        return "next";
      }
      const t = now.getHours() * 60 + now.getMinutes();
      return toMinutes(l.end || l.start) + (l.end ? 0 : 60) <= t ? "past" : "";
    }
    return WEEKDAYS.indexOf(day) < WEEKDAYS.indexOf(today) ? "past" : "";
  };

  return (
    <main className="screen">
      <BackButton />
      <header className="between rise" style={{ alignItems: "center", gap: 10 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="s13 muted" style={{ fontWeight: 700 }}>
            {weekLabel(monday)}
            {thisWeek ? " · This week" : week === 1 ? " · Next week" : ""}
          </span>
          <h1 className="h1" style={{ fontSize: 36 }}>
            Timetable
          </h1>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="round" aria-label="Previous week" onClick={() => setWeek(week - 1)}>
            <Icon name="chevronLeft" size={18} />
          </button>
          <button className="round" aria-label="Next week" onClick={() => setWeek(week + 1)}>
            <Icon name="chevron" size={18} />
          </button>
          <button
            className="round"
            aria-label="Add a lesson"
            onClick={() =>
              setEditing({
                lesson: { day, start: "09:00", end: "10:00", subject: "", room: "" },
                index: -1,
              })
            }
          >
            <Icon name="plus" size={18} />
          </button>
        </div>
      </header>

      {lessons.length === 0 ? (
        <section className="card stack empty-fun pop">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="calendar" size={26} />
          </span>
          <strong style={{ fontSize: 18 }}>Add your timetable</strong>
          <span className="muted">
            Take a photo or screenshot of your timetable and the AI fills it in. Or add lessons one
            by one with +.
          </span>
          {ai ? (
            <button className="btn big primary" onClick={() => setImporting(true)}>
              <Icon name="camera" size={18} />
              Scan my timetable
            </button>
          ) : (
            <span className="muted">Scanning needs the AI; you can still add lessons with +.</span>
          )}
        </section>
      ) : (
        <>
          <div className="day-tabs rise d1" role="tablist" aria-label="Day">
            {days.map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={day === d}
                className={d === today && thisWeek ? "is-today" : undefined}
                onClick={() => setDay(d)}
              >
                <span>{d}</span>
                <b>{dateOf(d)}</b>
              </button>
            ))}
          </div>

          {list.length === 0 ? (
            <div className="card empty">No lessons on {DAY_NAMES[day]}.</div>
          ) : (
            <section className="stack rise d2" style={{ gap: 6 }}>
              {withBreaks(list).map((row, i) => {
                if (row.kind === "break") {
                  return (
                    <div key={`b${i}`} className="les-brk">
                      {row.label}
                    </div>
                  );
                }
                const l = row.lesson;
                const st = state(l);
                const hw = homeworkFor(l, homework ?? []);
                const detail = [
                  l.room ? `Room ${l.room}` : "",
                  st === "now" ? `${inMinutes(left)} left` : "",
                  hw.length > 0 ? `${hw.length} homework` : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <button
                    key={`${l.start}-${l.subject}`}
                    className={`les${st ? ` ${st}` : ""}`}
                    onClick={() => setEditing({ lesson: l, index: lessons.indexOf(l) })}
                    aria-label={`${l.subject} ${l.start} to ${l.end}${l.room ? `, room ${l.room}` : ""}. Edit`}
                  >
                    <span className="t">{l.start}</span>
                    <span
                      className={`blk tone-${subjectTone(l.subject)}${st === "now" ? " now" : ""}`}
                    >
                      <span className="stack" style={{ gap: 1, minWidth: 0 }}>
                        <span className="n">{l.subject}</span>
                        {detail && <span className="r">{detail}</span>}
                      </span>
                      {st === "now" && <span className="chip">Now</span>}
                      {st === "next" && <span className="chip">Next</span>}
                    </span>
                  </button>
                );
              })}
            </section>
          )}

          {ai && (
            <button
              className="btn rise d3"
              style={{ alignSelf: "center" }}
              onClick={() => setImporting(true)}
            >
              <Icon name="camera" size={18} />
              Import from a photo
            </button>
          )}
        </>
      )}

      {importing && (
        <ImportSheet mode="timetable" onClose={() => setImporting(false)} onLessons={setLessons} />
      )}
      <AgendaList />

      {editing && (
        <LessonEditor
          lesson={editing.lesson}
          isNew={editing.index < 0}
          onClose={() => setEditing(null)}
          onSave={(lesson) => {
            save(
              editing.index < 0
                ? [...lessons, lesson]
                : lessons.map((l, i) => (i === editing.index ? lesson : l)),
            );
            setDay(lesson.day);
            setEditing(null);
          }}
          onDelete={() => {
            save(lessons.filter((_, i) => i !== editing.index));
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}

function LessonEditor({
  lesson,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  lesson: Lesson;
  isNew: boolean;
  onClose: () => void;
  onSave: (lesson: Lesson) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(lesson);
  const valid = draft.subject.trim() && draft.start && (!draft.end || draft.end > draft.start);
  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-label={isNew ? "Add a lesson" : "Edit lesson"}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) {
            onSave({ ...draft, subject: draft.subject.trim(), room: draft.room.trim() });
          }
        }}
      >
        <h2 className="h1" style={{ fontSize: 24 }}>
          {isNew ? "Add a lesson" : draft.subject || "Lesson"}
        </h2>
        <label className="stack" style={{ gap: 6 }}>
          <span className="h2">Subject</span>
          <input
            className="field"
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            placeholder="e.g. Maths"
            autoFocus={isNew}
          />
        </label>
        <label className="stack" style={{ gap: 6 }}>
          <span className="h2">Day</span>
          <select
            className="field"
            value={draft.day}
            onChange={(e) => setDraft({ ...draft, day: e.target.value as Weekday })}
          >
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {DAY_NAMES[d]}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label className="stack" style={{ gap: 6, flex: 1 }}>
            <span className="h2">Starts</span>
            <input
              className="field"
              type="time"
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </label>
          <label className="stack" style={{ gap: 6, flex: 1 }}>
            <span className="h2">Ends</span>
            <input
              className="field"
              type="time"
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </label>
        </div>
        <label className="stack" style={{ gap: 6 }}>
          <span className="h2">Room</span>
          <input
            className="field"
            value={draft.room}
            onChange={(e) => setDraft({ ...draft, room: e.target.value })}
            placeholder="e.g. S12"
          />
        </label>
        <button className="btn big primary" type="submit" disabled={!valid}>
          {isNew ? "Add lesson" : "Save"}
        </button>
        {!isNew && (
          <button className="btn ghost" type="button" onClick={onDelete}>
            Delete lesson
          </button>
        )}
      </form>
    </div>
  );
}
