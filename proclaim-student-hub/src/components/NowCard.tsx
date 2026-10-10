import { useEffect, useState } from "react";
import { useApp } from "../context.ts";
import { WEEKDAYS, type Lesson } from "../lib/aiFeatures.ts";
import { nowLesson } from "../lib/nowLesson.ts";
import { timetable } from "../lib/store.ts";
import { CountUp } from "./CountUp.tsx";
import { Icon } from "./Icon.tsx";

/** The first lesson of the next day with school (tomorrow onwards). */
function nextSchoolDay(lessons: Lesson[], now = new Date()): Lesson | null {
  const todayIdx = (now.getDay() + 6) % 7;
  for (let step = 1; step <= 7; step++) {
    const idx = (todayIdx + step) % 7;
    const first = lessons
      .filter((l) => WEEKDAYS.indexOf(l.day) === idx)
      .toSorted((a, b) => a.start.localeCompare(b.start))[0];
    if (first) {
      return first;
    }
  }
  return null;
}

/** A 2-minute warm-up before the lesson, made by the AI helper. */
const warmUp = (subject: string) =>
  `My ${subject} lesson starts soon. Give me a 2-minute warm-up: 3 quick questions on what a Year 9 ${subject} class is likely doing now, one at a time, and wait for my answer before the next.`;

/**
 * Today's hero: the lesson happening right now with a live countdown ring,
 * or the next lesson today. Ticks every 30 seconds so the ring moves.
 */
export function NowCard() {
  const { go, askTutor } = useApp();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const lessons = timetable.get();
  const info = nowLesson(lessons);
  if (info.state === "none") {
    // No more school today: a small card saying when it starts again.
    const first = nextSchoolDay(lessons);
    if (!first) {
      return null;
    }
    return (
      <button
        className="card next-day-card rise d1"
        onClick={() => go("timetable")}
        aria-label={`Next school day ${first.day}, starts ${first.start} with ${first.subject}`}
      >
        <span className="ico r40 tone-blue" aria-hidden="true">
          <Icon name="calendar" size={18} />
        </span>
        <span className="stack" style={{ gap: 1, flex: 1, minWidth: 0 }}>
          <span className="eyebrow">Next school day · {first.day}</span>
          <strong className="next-day-title">
            {first.start} {first.subject}
            {first.room ? ` · Room ${first.room}` : ""}
          </strong>
        </span>
        <Icon name="chevron" size={18} />
      </button>
    );
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
            {live && info.after
              ? ` · ${info.after.subject} next${info.after.room ? ` · Room ${info.after.room}` : ""}`
              : ""}
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
        <button className="btn now-btn" onClick={() => askTutor(warmUp(lesson.subject), "quiz")}>
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
