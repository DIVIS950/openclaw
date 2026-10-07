import { useRef, useState } from "react";
import { useApp } from "../context.ts";
import { dueLabel, isUrgent } from "../lib/format.ts";
import { progress, weekLog } from "../lib/store.ts";
import { subjectVars } from "../lib/subjects.ts";
import type { Homework } from "../lib/types.ts";

/** One homework line with a tick box that marks it done in Google too. */
const titleStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  textAlign: "left",
  border: "none",
  background: "none",
  padding: 0,
  color: "inherit",
};

export function HomeworkRow({ hw, style }: { hw: Homework; style?: React.CSSProperties }) {
  const { data, replaceHomework, handleError, openAssignment } = useApp();
  const [busy, setBusy] = useState(false);
  // Swipe right to tick it off: the row follows the finger, past 90px it counts.
  const [dx, setDx] = useState(0);
  const startX = useRef<number | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" || hw.done) {
      return;
    }
    startX.current = e.clientX;
  };
  const onMove = (e: React.PointerEvent) => {
    if (startX.current === null) {
      return;
    }
    setDx(Math.max(0, Math.min(140, e.clientX - startX.current)));
  };
  const onUp = () => {
    const far = dx >= 90;
    startX.current = null;
    setDx(0);
    if (far && !busy) {
      void toggle();
    }
  };

  const toggle = async () => {
    const next = { ...hw, done: !hw.done };
    replaceHomework(next);
    if (next.done) {
      progress.add(5);
      weekLog.add("hw", 1);
    }
    setBusy(true);
    try {
      await data.setDone(hw, next.done);
    } catch (err) {
      replaceHomework(hw);
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const label = (
    <>
      <div className="hw-title">{hw.title}</div>
      <div className="muted" style={{ fontSize: 12 }}>
        {hw.course === hw.source ? hw.source : `${hw.course} · ${hw.source}`}
      </div>
    </>
  );

  return (
    <div className={`hw-swipe${dx >= 90 ? " hw-swipe-armed" : ""}`} style={style}>
      <span className="hw-swipe-under" aria-hidden="true">
        <span className="hw-swipe-tick">✓</span> Done
      </span>
      <div
        className={`hw-row rise${hw.done ? " hw-done" : ""}`}
        style={dx ? { transform: `translateX(${dx}px)`, transition: "none" } : undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <input
          type="checkbox"
          checked={hw.done}
          disabled={busy}
          onChange={toggle}
          aria-label={`Mark ${hw.title} done`}
        />
        <span className="subject-dot" style={subjectVars(hw.course)} aria-hidden="true" />
        {/* Classroom and "Other" work is done here; Dr Frost etc. open their own site. */}
        {hw.source === "Classroom" || hw.source === "Other" ? (
          <button onClick={() => openAssignment(hw)} style={titleStyle}>
            {label}
          </button>
        ) : (
          // A real link: pop-ups opened from script are often blocked on phones.
          <a href={hw.link} target="_blank" rel="noopener noreferrer" style={titleStyle}>
            {label}
          </a>
        )}
        <span className={`chip${isUrgent(hw.due) ? " warm" : ""}`}>{dueLabel(hw.due)}</span>
      </div>
    </div>
  );
}
