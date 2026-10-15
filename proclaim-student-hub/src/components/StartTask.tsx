import { useState } from "react";
import { useApp } from "../context.ts";
import { startTask, type StartPlan } from "../lib/startTask.ts";
import { dayOf, todos } from "../lib/study.ts";
import type { Homework } from "../lib/types.ts";
import { Icon } from "./Icon.tsx";

// On a homework: one tap and the AI explains the task, splits it into steps
// and gives a skeleton to fill in. Steps can go to the to-do list.

export function StartTask({
  hw,
  work,
  onInsert,
}: {
  hw: Homework;
  work: string;
  onInsert: (outline: string) => void;
}) {
  const { ai, toast, handleError } = useApp();
  const [plan, setPlan] = useState<StartPlan | "loading" | null>(null);
  const [added, setAdded] = useState(false);

  if (!ai) {
    return null;
  }
  if (plan === null || plan === "loading") {
    return (
      <button
        className="lab-cta rise"
        disabled={plan === "loading"}
        onClick={async () => {
          setPlan("loading");
          try {
            setPlan(await startTask(ai, hw, work));
          } catch (err) {
            setPlan(null);
            handleError(err);
          }
        }}
      >
        <span className="lab-cta-icon" aria-hidden="true">
          <Icon
            name={plan === "loading" ? "loader" : "wand"}
            size={22}
            className={plan === "loading" ? "spin" : undefined}
          />
        </span>
        <span className="stack" style={{ gap: 2, flex: 1, textAlign: "left" }}>
          <strong style={{ fontSize: 16 }}>
            {plan === "loading" ? "Reading the task…" : "Start it for me"}
          </strong>
          <span className="muted">What it's asking, the steps, and an outline to fill in</span>
        </span>
      </button>
    );
  }

  const due = hw.due ? hw.due.slice(0, 10) : "";
  // Steps are due the day before the deadline (or today if it's that close).
  const stepDue = due
    ? due > dayOf(new Date())
      ? dayOf(new Date(new Date(`${due}T12:00:00`).getTime() - 864e5))
      : due
    : "";

  return (
    <section className="ai-card pop" aria-label="Getting started">
      <div className="between">
        <h3>
          <Icon name="wand" size={16} />
          Getting started
        </h3>
        <button className="link-btn" style={{ minHeight: 32 }} onClick={() => setPlan(null)}>
          Hide
        </button>
      </div>
      {plan.asking && (
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
          <strong>What it's asking: </strong>
          {plan.asking}
        </p>
      )}
      {plan.steps.length > 0 && (
        <ol className="ai-list" style={{ margin: 0 }}>
          {plan.steps.map((s, i) => (
            <li key={i}>
              {s.step} <span className="muted">· {s.minutes} min</span>
            </li>
          ))}
        </ol>
      )}
      {plan.check.length > 0 && (
        <div>
          <strong style={{ fontSize: 13 }}>Your teacher will look for</strong>
          <ul className="ai-list">
            {plan.check.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="row" style={{ flexWrap: "wrap" }}>
        {plan.outline && (
          <button
            className="btn small primary"
            onClick={() => {
              onInsert(plan.outline);
              toast("Outline added to your work. Fill in each part.");
            }}
          >
            <Icon name="doc" size={14} />
            Put the outline in my work
          </button>
        )}
        {plan.steps.length > 0 && (
          <button
            className="btn small"
            disabled={added}
            onClick={() => {
              for (const s of plan.steps) {
                todos.add({ text: s.step, due: stepDue, subject: hw.course, from: hw.title });
              }
              setAdded(true);
              toast(`${plan.steps.length} steps added to your to-do list.`);
            }}
          >
            <Icon name="todo" size={14} />
            {added ? "Added to to-do" : "Add steps to my to-do"}
          </button>
        )}
      </div>
    </section>
  );
}
