import { useEffect, useMemo, useState } from "react";
import { AddAnythingButton } from "../components/AddAnything.tsx";
import { DaySummary } from "../components/DaySummary.tsx";
import { HomeRow, inApp } from "../components/HomeRow.tsx";
import { Icon } from "../components/Icon.tsx";
import { WeeklyReport } from "../components/WeeklyReport.tsx";
import { WeekPlan } from "../components/WeekPlan.tsx";
import { useAiContext, useApp } from "../context.ts";
import { planEvening, upcomingLessons, type PlanStep } from "../lib/aiFeatures.ts";
import { dueLabel } from "../lib/format.ts";
import { level, progress, timetable } from "../lib/store.ts";
import { daysBetween, dayOf, groupTodos, prepTests, todos, type Todo } from "../lib/study.ts";
import { subjectVars } from "../lib/subjects.ts";
import type { Homework } from "../lib/types.ts";
import { UnlockCard } from "../pages/Unlock.tsx";
import { AiKeyCard } from "../pages/WebVersion.tsx";

// Home: what's due, in the order it's due. The single most urgent task gets
// the big card at the top; everything else is a grouped list you can tick
// or swipe. The AI summary, to-dos, the next test and lessons come after.

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

type Bucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "noDate";
const LABELS: Record<Bucket, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "This week",
  later: "Later",
  noDate: "No due date",
};

/** Due work in the buckets a student thinks in. */
export function bucketHomework(list: Homework[], now = new Date()): Record<Bucket, Homework[]> {
  const out: Record<Bucket, Homework[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
    noDate: [],
  };
  const today = startOfDay(now);
  for (const h of list.toSorted((a, b) => (a.due ?? "~").localeCompare(b.due ?? "~"))) {
    if (!h.due) {
      out.noDate.push(h);
      continue;
    }
    const days = Math.round((startOfDay(new Date(h.due)) - today) / DAY);
    const key: Bucket =
      days < 0
        ? "overdue"
        : days === 0
          ? "today"
          : days === 1
            ? "tomorrow"
            : days <= 7
              ? "week"
              : "later";
    out[key].push(h);
  }
  return out;
}

export function Home() {
  const app = useApp();
  const { homework, profile, ai, go, openAssignment, openAi } = app;
  const [version, setVersion] = useState(0);
  const [plan, setPlan] = useState<PlanStep[] | "loading" | null>(null);
  const [week, setWeek] = useState(false);
  const [showLater, setShowLater] = useState(false);
  const [stats] = useState(progress.get);
  const lvl = level(stats.xp);
  const today = dayOf(new Date());
  const open = useMemo(() => (homework ?? []).filter((h) => !h.done), [homework]);
  const buckets = useMemo(() => bucketHomework(open), [open]);
  const upNext = buckets.overdue[0] ?? buckets.today[0] ?? buckets.tomorrow[0] ?? buckets.week[0];
  const [todoList, setTodoList] = useState<Todo[]>(todos.all);
  const openTodos = groupTodos(todoList, today);
  const nextTest = prepTests
    .all()
    .filter((t) => t.date >= today)
    .toSorted((a, b) => a.date.localeCompare(b.date))[0];
  const upcoming = upcomingLessons(timetable.get());

  useEffect(() => setTodoList(todos.all()), [version]);
  useAiContext(
    "Home screen. Homework still to do: " +
      open
        .map((h) => `${h.title} (${h.course}, due ${h.due?.slice(0, 10) ?? "no date"})`)
        .join("; "),
  );

  const makePlan = async () => {
    if (!ai) {
      app.toast("The AI needs a key: More › Settings.");
      return;
    }
    setPlan("loading");
    try {
      const steps = await planEvening(ai, homework ?? []);
      setPlan(steps.length > 0 ? steps : null);
      if (steps.length === 0) {
        app.toast("Nothing to plan. Add some homework first!");
      }
    } catch (err) {
      setPlan(null);
      app.handleError(err);
    }
  };

  const tickTodo = (t: Todo) => {
    const next = todoList.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x));
    setTodoList(next);
    todos.save(next);
    if (!t.done) {
      progress.add(2);
    }
  };

  const openCount = open.length;
  return (
    <main className="screen ios">
      <header className="ios-header rise">
        <div className="between">
          <span className="eyebrow" style={{ paddingLeft: 0 }}>
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          <div className="row" style={{ gap: 6 }}>
            <button
              className="level-pill"
              aria-label={`Level ${lvl.level}, ${stats.xp} XP${stats.streak ? `, ${stats.streak} day streak` : ""}`}
              onClick={() => go("revise")}
            >
              <span
                className="level-ring"
                style={{ "--p": `${lvl.percent}%` } as React.CSSProperties}
              >
                {lvl.level}
              </span>
              {stats.streak > 0 && (
                <span className="row" style={{ gap: 2 }}>
                  <Icon name="flame" size={13} />
                  {stats.streak}
                </span>
              )}
            </button>
            <AddAnythingButton onSaved={() => setVersion((v) => v + 1)} />
          </div>
        </div>
        <h1 className="h1">{profile?.name ? `Hi ${profile.name.split(" ")[0]}` : "Today"}</h1>
        <p className="sub">
          {homework === null
            ? "Loading your homework…"
            : openCount === 0
              ? "Nothing to do. Enjoy it."
              : `${openCount} ${openCount === 1 ? "thing" : "things"} to do${buckets.overdue.length ? `, ${buckets.overdue.length} overdue` : ""}.`}
        </p>
      </header>

      <UnlockCard />
      <AiKeyCard />

      {upNext && (
        <section
          className="card up-next rise"
          style={subjectVars(upNext.course)}
          aria-label="Up next"
        >
          <span className="eyebrow" style={{ paddingLeft: 0 }}>
            Up next ·{" "}
            <span className={dueLabel(upNext.due) === "Overdue" ? "warm-text" : undefined}>
              {dueLabel(upNext.due)}
            </span>
          </span>
          <h2 className="up-next-title">{upNext.title}</h2>
          <span className="muted row" style={{ gap: 6 }}>
            <span className="subject-dot" aria-hidden="true" />
            {upNext.course}
            {upNext.course !== upNext.source && ` · ${upNext.source}`}
          </span>
          <div className="row" style={{ marginTop: 4 }}>
            {inApp(upNext) ? (
              <button
                className="btn primary"
                style={{ flex: 1 }}
                onClick={() => openAssignment(upNext)}
              >
                Start
              </button>
            ) : (
              <a
                className="btn primary"
                style={{ flex: 1 }}
                href={upNext.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in {upNext.source}
              </a>
            )}
            {ai && (
              <button
                className="btn"
                onClick={() =>
                  openAi({
                    context: `Homework: "${upNext.title}" (${upNext.course}). ${upNext.description}`,
                    question: `Help me get started with "${upNext.title}".`,
                  })
                }
              >
                <Icon name="sparkle" size={15} />
                Help me
              </button>
            )}
          </div>
        </section>
      )}

      {homework === null ? (
        <div className="ios-list">
          <div className="ios-row plain">
            <div className="skeleton light" style={{ flex: 1 }} />
          </div>
        </div>
      ) : (
        (["overdue", "today", "tomorrow", "week", "later", "noDate"] as Bucket[]).map((key) => {
          const items = buckets[key];
          if (items.length === 0) {
            return null;
          }
          const collapsed = key === "later" && !showLater;
          return (
            <section key={key} className="stack rise" style={{ gap: 6 }}>
              <div className="between">
                <h2 className={`eyebrow${key === "overdue" ? " warm-text" : ""}`}>
                  {LABELS[key]} · {items.length}
                </h2>
                {key === "later" && (
                  <button
                    className="link-btn"
                    style={{ minHeight: 28 }}
                    onClick={() => setShowLater((v) => !v)}
                  >
                    {collapsed ? "Show" : "Hide"}
                  </button>
                )}
              </div>
              {!collapsed && (
                <div className="ios-list">
                  {items.map((hw) => (
                    <HomeRow key={hw.id} hw={hw} />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
      {homework !== null && openCount === 0 && (
        <div className="card empty">All done. Tap + to add homework, a test or a to-do.</div>
      )}

      <section className="card stack rise hero" style={{ gap: 12 }} aria-label="Your day">
        <div className="between hero-label">
          <span className="row ai" style={{ gap: 6 }}>
            <Icon name="sparkle" size={16} />
            Your day
          </span>
        </div>
        <DaySummary key={version} />
        {ai && (
          <div className="row">
            <button
              className="btn primary"
              style={{ flex: 1 }}
              disabled={plan === "loading"}
              onClick={() => void makePlan()}
            >
              <Icon
                name={plan === "loading" ? "loader" : "sparkle"}
                size={15}
                className={plan === "loading" ? "spin" : undefined}
              />
              Plan tonight
            </button>
            <button className="btn soft" style={{ flex: 1 }} onClick={() => setWeek(true)}>
              <Icon name="calendar" size={15} />
              Plan my week
            </button>
          </div>
        )}
      </section>

      {Array.isArray(plan) && (
        <section className="ai-card pop" aria-label="Your plan for this evening">
          <div className="between">
            <h3>
              <Icon name="sparkle" size={16} />
              Tonight · {plan.reduce((n, s) => n + s.minutes, 0)} min
            </h3>
            <button className="link-btn" style={{ minHeight: 32 }} onClick={() => setPlan(null)}>
              Hide
            </button>
          </div>
          {plan.map((s, i) => (
            <div key={i} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
              <span className="chip accent" style={{ minWidth: 58, justifyContent: "center" }}>
                {s.minutes} min
              </span>
              <div>
                <div style={{ fontWeight: 600 }}>{s.title}</div>
                {s.tip && <div className="muted">{s.tip}</div>}
              </div>
            </div>
          ))}
        </section>
      )}
      {week && <WeekPlan onClose={() => setWeek(false)} />}

      {openTodos.overdue.length +
        openTodos.today.length +
        openTodos.later.length +
        openTodos.someday.length >
        0 && (
        <section className="stack rise" style={{ gap: 6 }}>
          <div className="between">
            <h2 className="eyebrow">To-do</h2>
            <button className="link-btn" style={{ minHeight: 28 }} onClick={() => go("todo")}>
              All ›
            </button>
          </div>
          <div className="ios-list">
            {[...openTodos.overdue, ...openTodos.today, ...openTodos.later, ...openTodos.someday]
              .slice(0, 5)
              .map((t) => (
                <div key={t.id} className="ios-row plain">
                  <button
                    className="tick"
                    aria-label={`Mark "${t.text}" done`}
                    onClick={() => tickTodo(t)}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="clip" style={{ display: "block" }}>
                      {t.text}
                    </span>
                    {t.due && (
                      <span
                        className={`muted${t.due < today ? " warm-text" : ""}`}
                        style={{ fontSize: 13 }}
                      >
                        {t.due === today
                          ? "Today"
                          : new Date(`${t.due}T12:00:00`).toLocaleDateString("en-GB", {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })}
                      </span>
                    )}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}

      {nextTest && (
        <section className="stack rise" style={{ gap: 6 }}>
          <h2 className="eyebrow">Next test</h2>
          <div className="ios-list">
            <button
              className="ios-row plain"
              onClick={() => go("tests")}
              style={subjectVars(nextTest.subject)}
            >
              <span className="subject-dot" aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="clip" style={{ display: "block", fontWeight: 600 }}>
                  {nextTest.topic}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {nextTest.subject}
                </span>
              </span>
              <span
                className={`chip${daysBetween(today, nextTest.date) <= 1 ? " warm" : " accent"}`}
              >
                {daysBetween(today, nextTest.date) === 0
                  ? "Today"
                  : `${daysBetween(today, nextTest.date)} days`}
              </span>
              <span className="ios-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          </div>
        </section>
      )}

      {upcoming.lessons.length > 0 && (
        <section className="stack rise" style={{ gap: 6 }}>
          <div className="between">
            <h2 className="eyebrow">Lessons · {upcoming.label}</h2>
            <button className="link-btn" style={{ minHeight: 28 }} onClick={() => go("timetable")}>
              Timetable ›
            </button>
          </div>
          <div className="lesson-strip">
            {upcoming.lessons.slice(0, 6).map((l, i) => (
              <button
                key={i}
                className="lesson-chip"
                style={subjectVars(l.subject)}
                onClick={() => go("timetable")}
              >
                <strong>{l.subject}</strong>
                <span>
                  {l.start}
                  {l.room ? ` · ${l.room}` : ""}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <WeeklyReport />
    </main>
  );
}
