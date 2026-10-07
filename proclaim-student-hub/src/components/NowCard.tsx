import { useEffect, useState } from "react";
import { useApp } from "../context.ts";
import { nowLesson } from "../lib/nowLesson.ts";
import { timetable } from "../lib/store.ts";
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
  const big = live ? info.minutesLeft : info.minutesUntil < 100 ? info.minutesUntil : lesson.start;
  const small = live ? "min left" : info.minutesUntil < 100 ? "min to go" : "starts";
  return (
    <section className="now-card" aria-label={live ? "Now" : "Next lesson"}>
      <div className="now-head">
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <span className="eyebrow">
            {live && <span className="live-dot" aria-hidden="true" />}
            {live ? "Now" : "Next up"}
            {lesson.room ? ` · Room ${lesson.room}` : ""}
          </span>
          <strong className="display now-title">{lesson.subject}</strong>
          <span className="sub">
            {lesson.start}
            {lesson.end ? ` – ${lesson.end}` : ""}
            {live && info.after ? ` · then ${info.after.subject}` : ""}
          </span>
        </div>
        <span
          className="now-ring"
          style={{ "--p": `${pct}%` } as React.CSSProperties}
          aria-label={live ? `${info.minutesLeft} minutes left, ${pct}% through` : "Not started"}
        >
          <span>
            <b>{big}</b>
            <small>{small}</small>
          </span>
        </span>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <button className="btn" style={{ flex: 1 }} onClick={() => go("timetable")}>
          <Icon name="calendar" size={18} />
          Timetable
        </button>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => go("tutor")}>
          <Icon name="sparkle" size={18} />
          Prep me
        </button>
      </div>
    </section>
  );
}
