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
  // Ring: r=32 → circumference 201; the offset is what's left to draw.
  const off = 201 * (1 - (live ? info.progress : 0));
  return (
    <section className="now-card rise d1" aria-label={live ? "Now" : "Next lesson"}>
      <div className="now-head">
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <span className="now-eyebrow">
            {live ? "Now" : "Next up"}
            {lesson.room ? ` · Room ${lesson.room}` : ""}
          </span>
          <strong className="now-title">{lesson.subject}</strong>
          <span className="now-sub">
            {lesson.start}
            {lesson.end ? ` – ${lesson.end}` : ""}
            {live && info.after ? ` · ${info.after.subject} next` : ""}
          </span>
        </div>
        <span
          className="bento-ring"
          style={{ "--off": off } as React.CSSProperties}
          aria-label={live ? `${info.minutesLeft} minutes left, ${pct}% through` : "Not started"}
        >
          <svg viewBox="0 0 76 76" width="76" height="76" aria-hidden="true">
            <circle
              cx="38"
              cy="38"
              r="32"
              fill="none"
              stroke="rgba(255,255,255,.22)"
              strokeWidth="8"
            />
            <circle
              className="arc"
              cx="38"
              cy="38"
              r="32"
              fill="none"
              stroke="#fff"
              strokeWidth="8"
              strokeLinecap="round"
            />
          </svg>
          <span className="ring-text">
            <b>{big === null ? lesson.start : <CountUp n={big} delay={600} />}</b>
            <small>{big === null ? "STARTS" : "MIN"}</small>
          </span>
        </span>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <button className="btn now-btn" onClick={() => go("tutor")}>
          <Icon name="sparkle" size={18} />
          Prep me
        </button>
        <button className="btn now-btn ghost" onClick={() => go("timetable")}>
          Full day
        </button>
      </div>
    </section>
  );
}
