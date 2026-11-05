import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { revisionSchedule } from "../lib/aiFeatures.ts";
import { progress, schedule, type SavedSchedule } from "../lib/store.ts";

// Test dates and the AI's day-by-day revision plan (moved here from the old
// revision screen). The Lab home counts down to the next test from these.

export function RevisionPlan({ topic, onBack }: { topic: string; onBack: () => void }) {
  const { ai, handleError } = useApp();
  const [plan, setPlan] = useState<SavedSchedule>(schedule.get);
  const [newTopic, setNewTopic] = useState(topic);
  const [newDate, setNewDate] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (next: SavedSchedule) => {
    setPlan(next);
    schedule.save(next);
  };

  const make = async () => {
    if (!ai || plan.tests.length === 0) {
      return;
    }
    setBusy(true);
    try {
      update({ ...plan, days: await revisionSchedule(ai, plan.tests), done: [] });
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 4 }}>
        <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onBack}>
          ‹ Revision Lab
        </button>
        <h1 className="h1">Tests and plan</h1>
        <p className="sub">
          Add your test dates. The AI spreads your revision over the days before.
        </p>
      </header>
      <div className="card stack">
        <h2 className="h2">Your tests</h2>
        {plan.tests.map((test, i) => (
          <div key={i} className="between">
            <span>
              <strong>{test.topic}</strong> <span className="muted">· {test.date}</span>
            </span>
            <button
              className="round"
              style={{ width: 32, height: 32 }}
              aria-label={`Remove ${test.topic}`}
              onClick={() => update({ ...plan, tests: plan.tests.filter((_, j) => j !== i) })}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
        <form
          className="row"
          style={{ flexWrap: "wrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (newTopic.trim() && newDate) {
              update({
                ...plan,
                tests: [...plan.tests, { topic: newTopic.trim(), date: newDate }],
              });
              setNewTopic("");
              setNewDate("");
            }
          }}
        >
          <label htmlFor="test-topic" className="sr-only">
            Test topic
          </label>
          <input
            id="test-topic"
            className="field"
            style={{ flex: "1 1 140px" }}
            placeholder="Test topic"
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
          />
          <label htmlFor="test-date" className="sr-only">
            Test date
          </label>
          <input
            id="test-date"
            className="field"
            style={{ flex: "1 1 120px" }}
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
          <button className="btn" type="submit" disabled={!newTopic.trim() || !newDate}>
            Add test
          </button>
        </form>
      </div>

      {ai ? (
        <button
          className="btn big primary"
          disabled={busy || plan.tests.length === 0}
          onClick={() => void make()}
        >
          <Icon
            name={busy ? "loader" : "sparkle"}
            size={18}
            className={busy ? "spin" : undefined}
          />
          {busy
            ? "Planning your revision…"
            : plan.days.length
              ? "Make a new plan"
              : "Make my revision plan"}
        </button>
      ) : (
        <div className="banner">The AI needs you signed in to make a plan.</div>
      )}

      {plan.days.map((day) => (
        <div key={day.date} className="card stack pop" style={{ gap: 8 }}>
          <div className="eyebrow">
            {new Date(`${day.date}T12:00:00`).toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "short",
            })}
          </div>
          {day.items.map((item, i) => {
            const key = `${day.date}|${i}`;
            const done = plan.done.includes(key);
            return (
              <label key={key} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={done}
                  style={{ width: 20, height: 20, accentColor: "var(--accent)" }}
                  onChange={() => {
                    if (!done) {
                      progress.add(5);
                    }
                    update({
                      ...plan,
                      done: done ? plan.done.filter((k) => k !== key) : [...plan.done, key],
                    });
                  }}
                />
                <span
                  style={
                    done ? { textDecoration: "line-through", color: "var(--muted)" } : undefined
                  }
                >
                  <strong>{item.topic}</strong>: {item.activity}{" "}
                  <span className="muted">({item.minutes} min)</span>
                </span>
              </label>
            );
          })}
        </div>
      ))}
    </main>
  );
}
