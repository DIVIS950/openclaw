import { useState } from "react";
import { useApp } from "../context.ts";
import { dueLabel, isUrgent } from "../lib/format.ts";
import type { Homework } from "../lib/types.ts";

/** One homework line with a tick box that marks it done in Google too. */
export function HomeworkRow({ hw, style }: { hw: Homework; style?: React.CSSProperties }) {
  const { data, replaceHomework, handleError, openAssignment } = useApp();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    const next = { ...hw, done: !hw.done };
    replaceHomework(next);
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

  return (
    <div className={`hw-row rise${hw.done ? " hw-done" : ""}`} style={style}>
      <input
        type="checkbox"
        checked={hw.done}
        disabled={busy}
        onChange={toggle}
        aria-label={`Mark ${hw.title} done`}
      />
      <button
        onClick={() =>
          hw.source === "Classroom"
            ? openAssignment(hw)
            : window.open(hw.link, "_blank", "noopener")
        }
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          border: "none",
          background: "none",
          padding: 0,
        }}
      >
        <div className="hw-title">{hw.title}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {hw.course === hw.source ? hw.source : `${hw.course} · ${hw.source}`}
        </div>
      </button>
      <span className={`chip${isUrgent(hw.due) ? " warm" : ""}`}>{dueLabel(hw.due)}</span>
    </div>
  );
}
