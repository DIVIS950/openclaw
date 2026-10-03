import { useRef, useState } from "react";
import { useApp } from "../context.ts";
import { buzz } from "../lab/fx.ts";
import { dueLabel, isUrgent } from "../lib/format.ts";
import { progress, weekLog } from "../lib/store.ts";
import { subjectVars } from "../lib/subjects.ts";
import type { Homework } from "../lib/types.ts";
import { Icon } from "./Icon.tsx";

// One homework row on Home: tap to open, tick the circle to finish, or swipe
// it right to finish (the green "Done" slides in behind it, like Mail).

const SWIPE_DONE = 88;

export function useToggleDone(hw: Homework) {
  const { data, replaceHomework, handleError, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    const next = { ...hw, done: !hw.done };
    replaceHomework(next);
    if (next.done) {
      progress.add(5);
      weekLog.add("hw", 1);
      buzz(12);
      toast("Done. +5 XP");
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
  return { toggle, busy };
}

/** Classroom and "Other" work is done inside the app; the rest opens its own site. */
export const inApp = (hw: Homework) => hw.source === "Classroom" || hw.source === "Other";

export function HomeRow({ hw }: { hw: Homework }) {
  const { openAssignment } = useApp();
  const { toggle, busy } = useToggleDone(hw);
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiping = useRef(false);

  const open = () => {
    if (inApp(hw)) {
      openAssignment(hw);
    } else {
      window.open(hw.link, "_blank", "noopener");
    }
  };

  const onDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiping.current = false;
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current || hw.done) {
      return;
    }
    const x = e.clientX - start.current.x;
    const y = e.clientY - start.current.y;
    // Only a clearly sideways drag counts, so the list still scrolls normally.
    if (!swiping.current && Math.abs(x) > 12 && Math.abs(x) > Math.abs(y) * 1.5) {
      swiping.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(start.current.id);
    }
    if (swiping.current) {
      setDx(Math.max(0, Math.min(x, SWIPE_DONE + 24)));
    }
  };
  const onUp = () => {
    if (swiping.current && dx >= SWIPE_DONE) {
      void toggle();
    }
    setDx(0);
    start.current = null;
    swiping.current = false;
  };

  const overdue = Boolean(hw.due) && dueLabel(hw.due) === "Overdue";
  return (
    <div className="swipe-row" style={subjectVars(hw.course)}>
      <div className={`swipe-back${dx >= SWIPE_DONE ? " ready" : ""}`} aria-hidden="true">
        <Icon name="check" size={18} />
        Done
      </div>
      <div
        className={`ios-row hw-line${hw.done ? " hw-done" : ""}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <button
          className={`tick${hw.done ? " on" : ""}`}
          aria-label={hw.done ? `Mark ${hw.title} not done` : `Mark ${hw.title} done`}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void toggle();
          }}
        >
          {hw.done && <Icon name="check" size={14} />}
        </button>
        <button className="hw-open" onClick={open} aria-label={`Open ${hw.title}`}>
          <span className="hw-title">{hw.title}</span>
          <span className="hw-sub">
            <span className="subject-dot" aria-hidden="true" />
            {hw.course}
            {hw.due && (
              <span className={overdue ? "warm-text" : isUrgent(hw.due) ? "soon" : undefined}>
                {" · "}
                {dueLabel(hw.due)}
              </span>
            )}
          </span>
        </button>
        <span className="ios-chevron" aria-hidden="true">
          ›
        </span>
      </div>
    </div>
  );
}
