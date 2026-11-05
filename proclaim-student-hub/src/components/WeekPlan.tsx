import { useEffect, useState } from "react";
import { useApp } from "../context.ts";
import { agenda } from "../lib/agenda.ts";
import { timetable } from "../lib/store.ts";
import { dayOf, prepTests, todos, tutoring } from "../lib/study.ts";
import { subjectVars } from "../lib/subjects.ts";
import { planWeek, type WeekDay } from "../lib/weekPlan.ts";
import { dateLabel } from "./Agenda.tsx";
import { Icon } from "./Icon.tsx";

// Today's "Plan my week" card: the AI's day-by-day plan, which can go
// straight into the to-do list with the right dates.

export function WeekPlan({ onClose }: { onClose: () => void }) {
  const { ai, homework, toast, handleError, go } = useApp();
  const [plan, setPlan] = useState<WeekDay[] | "loading" | null>("loading");
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
          tutors: tutoring.tutors(),
        },
        today,
      );
      setPlan(week.length ? week : null);
      if (!week.length) {
        toast("Nothing to plan yet. Add homework or a test first.");
        onClose();
      }
    } catch (err) {
      setPlan(null);
      handleError(err);
      onClose();
    }
  };

  // Planning starts as soon as the card is asked for.
  useEffect(() => {
    void make();
  }, []);

  if (plan === null || plan === "loading") {
    return (
      <section className="card stack pop" aria-label="Planning your week">
        <div className="row" style={{ gap: 10 }}>
          <Icon name="loader" size={18} className="spin" />
          <strong>Planning your week…</strong>
        </div>
        <div className="skeleton light" />
        <div className="skeleton light" style={{ width: "70%" }} />
      </section>
    );
  }

  const total = plan.reduce((n, d) => n + d.items.reduce((m, i) => m + i.minutes, 0), 0);
  return (
    <section className="card stack pop week-plan" aria-label="Your week">
      <div className="between">
        <h2 className="h2">Your week · {Math.round(total / 60)} h</h2>
        <button className="link-btn" onClick={onClose}>
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
