import { useEffect, useState } from "react";
import { useApp } from "../context.ts";
import { nowLesson } from "../lib/nowLesson.ts";
import { timetable } from "../lib/store.ts";
import { subjectVars } from "../lib/subjects.ts";
import { Icon } from "./Icon.tsx";

/**
 * Today's hero: the lesson happening right now with a live countdown ring,
 * or the next lesson today. Ticks every 30 seconds so the ring moves.
 */
export function NowCard() {
  const { go } = useApp();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const info = nowLesson(timetable.get());
  if (info.state === "none") {
    return null;
  }
  const lesson = info.lesson;
  const live = info.state === "now";
  const pct = live ? Math.round(info.progress * 100) : 0;
  const when = live
    ? `${info.minutesLeft} min left`
    : info.minutesUntil < 60
      ? `in ${info.minutesUntil} min`
      : `at ${lesson.start}`;
  return (
    <section
      className="now-card glow rise"
      style={subjectVars(lesson.subject)}
      aria-label={live ? "Now" : "Next lesson"}
    >
      <div className="between">
        <span className="row" style={{ gap: 8 }}>
          {live && <span className="live-dot" aria-hidden="true" />}
          <span className="eyebrow" style={{ color: "var(--ink)" }}>
            {live ? "Now" : "Next up"}
          </span>
        </span>
        <span className="chip accent">{when}</span>
      </div>
      <div className="row" style={{ gap: 16 }}>
        <span
          className="now-ring"
          style={{ "--p": `${pct}%` } as React.CSSProperties}
          aria-label={live ? `${pct}% through` : "Not started"}
        >
          <span>{live ? `${pct}%` : lesson.start}</span>
        </span>
        <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
          <strong className="display now-title">{lesson.subject}</strong>
          <span className="muted">
            {lesson.room ? `Room ${lesson.room}` : `${lesson.start}–${lesson.end || "?"}`}
            {live && info.after ? ` · then ${info.after.subject}` : ""}
          </span>
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => go("timetable")}>
          <Icon name="calendar" size={16} />
          Timetable
        </button>
        <button className="btn soft" onClick={() => go("tutor")}>
          <Icon name="sparkle" size={16} />
          Prep me
        </button>
      </div>
    </section>
  );
}
