import { useState } from "react";
import { useApp } from "../context.ts";
import { agenda } from "../lib/agenda.ts";
import { timetable } from "../lib/store.ts";
import { dayOf, prepTests, todos } from "../lib/study.ts";
import { subjectVars } from "../lib/subjects.ts";
import { planWeek, type WeekDay } from "../lib/weekPlan.ts";
import { dateLabel } from "./Agenda.tsx";
import { Icon } from "./Icon.tsx";

// Today's "Plan my week" card: the AI's day-by-day plan, which can go
// straight into the to-do list with the right dates.

export function WeekPlan() {
  const { ai, homework, toast, handleError, go } = useApp();
  const [plan, setPlan] = useState<WeekDay[] | "loading" | null>(null);
  const [saved, setSaved] = useState(false);
  const today = dayOf(new Date());
  if (!ai) {
    return null;
  }

  const make = async () => {
    setPlan("loading");
    setSaved(false);
    try {
      const week = await planWeek(
        ai,
        {
          homework: homework ?? [],
          tests: prepTests.all(),
          todos: todos.all(),
          events: agenda.all(),
          lessons: timetable.get(),
        },
        today,
      );
      setPlan(week.length ? week : null);
      if (!week.length) {
        toast("Nothing to plan yet. Add homework or a test first.");
      }
    } catch (err) {
      setPlan(null);
      handleError(err);
    }
  };

  if (plan === null || plan === "loading") {
    return (
      <button className="lab-cta rise" disabled={plan === "loading"} onClick={() => void make()}>
        <span className="lab-cta-icon" aria-hidden="true">
          <Icon
            name={plan === "loading" ? "loader" : "calendar"}
            size={22}
            className={plan === "loading" ? "spin" : undefined}
          />
        </span>
        <span className="stack" style={{ gap: 2, flex: 1, textAlign: "left" }}>
          <strong style={{ fontSize: 16 }}>
            {plan === "loading" ? "Planning your week…" : "Plan my week"}
          </strong>
          <span className="muted">Homework, test prep and to-dos spread over the next 7 days</span>
        </span>
      </button>
    );
  }

  const total = plan.reduce((n, d) => n + d.items.reduce((m, i) => m + i.minutes, 0), 0);
  return (
    <section className="card stack pop week-plan" aria-label="Your week">
      <div className="between">
        <h2 className="h2">Your week · {Math.round(total / 60)} h</h2>
        <button className="link-btn" onClick={() => setPlan(null)}>
          Hide
        </button>
      </div>
      {plan.map((d) => (
        <div key={d.date} className="week-day">
          <div className="between">
            <strong>{dateLabel(d.date, today)}</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {d.items.reduce((m, i) => m + i.minutes, 0)} min
            </span>
          </div>
          {d.note && (
            <div className="muted" style={{ fontSize: 13 }}>
              {d.note}
            </div>
          )}
          {d.items.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>
              Free 🎉
            </div>
          ) : (
            d.items.map((it, i) => (
              <div key={i} className="week-item" style={subjectVars(it.subject)}>
                <span className="subject-dot" />
                <span style={{ flex: 1, minWidth: 0 }}>{it.title}</span>
                <span className="chip">{it.minutes} min</span>
              </div>
            ))
          )}
        </div>
      ))}
      <div className="row">
        <button
          className="btn primary"
          style={{ flex: 1 }}
          disabled={saved}
          onClick={() => {
            let n = 0;
            for (const d of plan) {
              for (const it of d.items) {
                todos.add({ text: it.title, due: d.date, subject: it.subject, from: "Week plan" });
                n++;
              }
            }
            setSaved(true);
            toast(`${n} tasks added to your to-do list, each on its day.`);
          }}
        >
          {saved ? "Added to to-do" : "Put it in my to-do"}
        </button>
        {saved && (
          <button className="btn" onClick={() => go("todo")}>
            Open to-do
          </button>
        )}
      </div>
      <button className="btn ghost" onClick={() => void make()}>
        Make a new plan
      </button>
    </section>
  );
}
