import { useEffect, useState } from "react";
import { AgendaList } from "../components/Agenda.tsx";
import { AskButton } from "../components/AskButton.tsx";
import { Icon } from "../components/Icon.tsx";
import { ImportSheet } from "../components/ImportSheet.tsx";
import { useAiContext, useApp } from "../context.ts";
import { WEEKDAYS, type Lesson, type Weekday } from "../lib/aiFeatures.ts";
import { timetable } from "../lib/store.ts";
import { subjectVars } from "../lib/subjects.ts";
import { lessonProgress, lessonsOn, nowAndNext, schoolDays, weekdayOf } from "../lib/timetable.ts";
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

/** The day of the month for this weekday in the current week. */
const dateOf = (d: Weekday, now: Date) => {
  const date = new Date(now);
  date.setDate(now.getDate() + WEEKDAYS.indexOf(d) - ((now.getDay() + 6) % 7));
  return date.getDate();
};

const inMinutes = (n: number) =>
  n < 60 ? `${n} min` : `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ""}`;

function homeworkFor(lesson: Lesson, homework: Homework[]): Homework[] {
  const key = lesson.subject.toLowerCase().split(/\s+/)[0];
  return key.length < 3
    ? []
    : homework.filter((h) => !h.done && `${h.course} ${h.title}`.toLowerCase().includes(key));
}

export function Timetable() {
  const { ai, homework, go } = useApp();
  const now = useNow();
  const [lessons, setLessons] = useState<Lesson[]>(timetable.get);
  const days = schoolDays(lessons);
  const today = weekdayOf(now);
  const [day, setDay] = useState<Weekday>(days.includes(today) ? today : "Mon");
  const [editing, setEditing] = useState<{ lesson: Lesson; index: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const { current, left, next, until } = nowAndNext(lessons, now);
  const list = lessonsOn(lessons, day);
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

  return (
    <main className="screen">
      <header className="between rise">
        <div className="stack" style={{ gap: 4 }}>
          <button
            className="link-btn"
            style={{ alignSelf: "flex-start" }}
            onClick={() => go("today")}
          >
            ‹ Today
          </button>
          <h1 className="h1">Timetable</h1>
        </div>
        <div className="head-chips">
          <AskButton />
          <button
            className="round dark"
            aria-label="Add a lesson"
            onClick={() =>
              setEditing({
                lesson: { day, start: "09:00", end: "10:00", subject: "", room: "" },
                index: -1,
              })
            }
          >
            <Icon name="plus" size={20} />
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
          {(current || next) && (
            <section
              className="now-card pop"
              style={subjectVars((current ?? next)?.subject ?? "")}
              aria-live="polite"
            >
              {current ? (
                <>
                  <span className="now-label">
                    <span className="subject-dot" /> Now
                  </span>
                  <div className="row" style={{ gap: 12 }}>
                    <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <strong style={{ fontSize: 22 }}>{current.subject}</strong>
                      <span>
                        {current.room ? `Room ${current.room} · ` : ""}ends in {inMinutes(left)}
                      </span>
                    </div>
                  </div>
                  <div className="now-bar">
                    <div style={{ width: `${lessonProgress(current, now) * 100}%` }} />
                  </div>
                  {next && (
                    <span style={{ opacity: 0.85 }}>
                      Next: {next.subject} at {next.start}
                      {next.room ? ` · ${next.room}` : ""}
                    </span>
                  )}
                </>
              ) : (
                next && (
                  <>
                    <span className="now-label">Next up · in {inMinutes(until ?? 0)}</span>
                    <div className="row" style={{ gap: 12 }}>
                      <div className="stack" style={{ gap: 2 }}>
                        <strong style={{ fontSize: 22 }}>{next.subject}</strong>
                        <span>
                          {next.start}
                          {next.room ? ` · Room ${next.room}` : ""}
                        </span>
                      </div>
                    </div>
                  </>
                )
              )}
            </section>
          )}

          <div className="day-tabs" role="tablist" aria-label="Day">
            {days.map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={day === d}
                className={d === today ? "is-today" : undefined}
                onClick={() => setDay(d)}
              >
                {d}
                <b>{dateOf(d, now)}</b>
              </button>
            ))}
          </div>

          {list.length === 0 ? (
            <div className="card empty">No lessons on {DAY_NAMES[day]}.</div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {list.map((l, i) => {
                const isNow = day === today && current === l;
                const hw = homeworkFor(l, homework ?? []);
                return (
                  <button
                    key={`${l.start}-${l.subject}`}
                    className={`lesson rise${isNow ? " now" : ""}`}
                    style={{ ...subjectVars(l.subject), animationDelay: `${i * 0.05}s` }}
                    onClick={() => setEditing({ lesson: l, index: lessons.indexOf(l) })}
                    aria-label={`${l.subject} ${l.start} to ${l.end}${l.room ? `, room ${l.room}` : ""}. Edit`}
                  >
                    <span className="lesson-time">
                      <strong>{l.start}</strong>
                      <span>{l.end}</span>
                    </span>
                    <span className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                      <strong className="lesson-name">{l.subject}</strong>
                      <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        {l.room && <span className="lesson-room">Room {l.room}</span>}
                        {hw.length > 0 && (
                          <span className="lesson-room">· {hw.length} homework</span>
                        )}
                      </span>
                    </span>
                    {isNow && <span className="now-dot" aria-label="Now" />}
                  </button>
                );
              })}
            </div>
          )}

          {ai && (
            <button className="btn block" onClick={() => setImporting(true)}>
              <Icon name="camera" size={16} />
              Scan a new timetable
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
