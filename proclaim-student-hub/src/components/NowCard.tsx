import { useEffect, useState } from "react";
import { useApp } from "../context.ts";
import { nowLesson } from "../lib/nowLesson.ts";
import { timetable } from "../lib/store.ts";
import { CountUp } from "./CountUp.tsx";
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
  const big = live ? info.minutesLeft : info.minutesUntil < 100 ? info.minutesUntil : null;
  const small = live ? "min left" : info.minutesUntil < 100 ? "min to go" : "starts";
  // Ring: r=36 → circumference 226.2; the offset is what's left to draw.
  const off = 226.2 * (1 - (live ? info.progress : 0));
  return (
    <section className="card hero now-card rise d2" aria-label={live ? "Now" : "Next lesson"}>
      <div className="now-head">
        <div className="stack" style={{ gap: 7, minWidth: 0 }}>
          <span className="eyebrow row" style={{ color: "var(--accent-t)", gap: 8 }}>
            {live && <span className="dot" aria-hidden="true" />}
            {live ? "Now" : "Next up"}
            {lesson.room ? ` · Room ${lesson.room}` : ""}
          </span>
          <strong className="h1 now-title" style={{ fontSize: 30 }}>
            {lesson.subject}
          </strong>
          <span className="t2 s13">
            {lesson.start}
            {lesson.end ? ` – ${lesson.end}` : ""}
            {live && info.after ? ` · ${info.after.subject} next` : ""}
          </span>
        </div>
        <span
          className="ring-wrap now-ring"
          style={{ "--off": off } as React.CSSProperties}
          aria-label={live ? `${info.minutesLeft} minutes left, ${pct}% through` : "Not started"}
        >
          <svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true">
            <circle cx="42" cy="42" r="36" fill="none" stroke="var(--line)" strokeWidth="7" />
            <circle
              className="arc"
              cx="42"
              cy="42"
              r="36"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="7"
              strokeLinecap="round"
            />
          </svg>
          <span className="ring-text">
            <b>{big === null ? lesson.start : <CountUp n={big} delay={600} />}</b>
            <small>{small}</small>
          </span>
        </span>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <button className="btn" onClick={() => go("timetable")}>
          <Icon name="calendar" size={18} />
          Timetable
        </button>
        <button className="btn primary" onClick={() => go("tutor")}>
          <Icon name="sparkle" size={18} />
          Prep me
        </button>
      </div>
    </section>
  );
}
