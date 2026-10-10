import { useRef, useState } from "react";
import { Briefing } from "../components/Briefing.tsx";
import { CountUp } from "../components/CountUp.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import { NowCard } from "../components/NowCard.tsx";
import { useAiContext, useApp, type Screen } from "../context.ts";
import { WEEKDAYS, type Lesson } from "../lib/aiFeatures.ts";
import { dueLabel, greeting, isUrgent } from "../lib/format.ts";
import { level, progress, timetable, todoXp } from "../lib/store.ts";
import { addDays, dayOf, daysBetween, groupTodos, prepTests, todos } from "../lib/study.ts";
import type { Homework } from "../lib/types.ts";
import { UnlockCard } from "../pages/Unlock.tsx";

// Today, as on the Bento canvas: greeting, the lesson on now (accent hero),
// the daily brief, two big numbers (due today, next test) and the rest of the
// day. On a wide screen the same blocks become a grid with the day down the
// right-hand side (bento.css). The week's report lives in More.

const SHORTCUTS: { screen: Screen; label: string; icon: IconName; tone: string }[] = [
  { screen: "revise", label: "Revise", icon: "flask", tone: "violet" },
  { screen: "tests", label: "Tests", icon: "timer", tone: "pink" },
  { screen: "tutoring", label: "Tutoring", icon: "users", tone: "orange" },
  { screen: "inbox", label: "Inbox", icon: "mail", tone: "blue" },
];

const LONG_DAY: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

/**
 * The day list: lessons today that haven't started yet ("Later today"), or,
 * when today is over or a weekend, the whole of the next school day.
 */
export function dayList(lessons: Lesson[], now = new Date()): { label: string; lessons: Lesson[] } {
  const todayIdx = (now.getDay() + 6) % 7;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const sorted = lessons.toSorted((a, b) => a.start.localeCompare(b.start));
  const later = sorted.filter((l) => WEEKDAYS.indexOf(l.day) === todayIdx && l.start > time);
  if (later.length > 0) {
    return { label: "Later today", lessons: later };
  }
  // School still on today (only the current lesson left): nothing "later".
  const onNow = sorted.some(
    (l) => WEEKDAYS.indexOf(l.day) === todayIdx && (l.end || l.start) > time,
  );
  if (onNow) {
    return { label: "", lessons: [] };
  }
  for (let step = 1; step <= 7; step++) {
    const idx = (todayIdx + step) % 7;
    const day = sorted.filter((l) => WEEKDAYS.indexOf(l.day) === idx);
    if (day.length > 0) {
      return { label: `Next school day · ${LONG_DAY[WEEKDAYS[idx]]}`, lessons: day };
    }
  }
  return { label: "", lessons: [] };
}

/** The three open homework items due soonest (undated ones last). */
export function dueNext(open: Homework[], count = 3): Homework[] {
  return open
    .toSorted((a, b) => (a.due ?? "\uffff").localeCompare(b.due ?? "\uffff"))
    .slice(0, count);
}

/** "Morning," over "Honza" when the name is known, else "Good morning". */
function Hello({ name }: { name: string | undefined }) {
  const g = greeting();
  const first = name?.trim().split(/\s+/)[0];
  if (!first) {
    return <>{g}</>;
  }
  const part = g.replace(/^Good /, "");
  return (
    <>
      {part[0].toUpperCase() + part.slice(1)},
      <br />
      {first}
    </>
  );
}

export function Today({ demoBanner }: { demoBanner?: React.ReactNode }) {
  const app = useApp();
  const { homework, profile, go, openAssignment } = app;
  const [lessons] = useState<Lesson[]>(timetable.get);
  const [stats] = useState(progress.get);
  const [tests] = useState(prepTests.all);
  const [todoAll, setTodoAll] = useState(todos.all);
  // Ticking a to-do here: saved, XP once, and an Undo in the toast. The row
  // stays in place, struck through, for a moment, so a second tap lands on it
  // (and does nothing) instead of on the next to-do.
  const [settling, setSettling] = useState<string[]>([]);
  const lastTick = useRef(0);
  const tickTodo = (id: string) => {
    if (Date.now() - lastTick.current < 450 || todos.all().find((t) => t.id === id)?.done) {
      return;
    }
    lastTick.current = Date.now();
    setSettling((s) => [...s, id]);
    window.setTimeout(() => setSettling((s) => s.filter((x) => x !== id)), 1400);
    const before = todos.all();
    todos.save(before.map((t) => (t.id === id ? { ...t, done: true } : t)));
    todoXp.tick(id);
    setTodoAll(todos.all());
    app.toast("To-do done.", {
      label: "Undo",
      run: () => {
        setSettling((s) => s.filter((x) => x !== id));
        todoXp.undo(id);
        todos.save(todos.all().map((t) => (t.id === id ? { ...t, done: false } : t)));
        setTodoAll(todos.all());
      },
    });
  };
  const upcoming = dayList(lessons);
  const lvl = level(stats.xp);

  const open = (homework ?? []).filter((h) => !h.done);
  const next3 = dueNext(open);
  // Open to-dos, most urgent first: overdue, today, this week, any time.
  const today = dayOf(new Date());
  const todoGroups = groupTodos(
    todoAll.map((t) => (settling.includes(t.id) ? { ...t, done: false } : t)),
    today,
  );
  const todoList = [
    ...todoGroups.overdue,
    ...todoGroups.today,
    ...todoGroups.later,
    ...todoGroups.someday,
  ];
  const todoOpen = todoList.length;
  const todoNext = todoList.slice(0, 3);
  useAiContext(
    "Today screen. Homework still to do: " +
      open
        .map((h) => `${h.title} (${h.course}, due ${h.due?.slice(0, 10) ?? "no date"})`)
        .join("; "),
  );

  // The two big numbers: homework due today, and days to the next test.
  const weekEnd = addDays(today, 7);
  const dueDay = (iso?: string) => (iso ? dayOf(new Date(iso)) : "");
  const dueToday = open.filter((h) => dueDay(h.due) <= today && h.due).length;
  const dueWeek = open.filter((h) => {
    const d = dueDay(h.due);
    return d > today && d <= weekEnd;
  }).length;
  const nextTest = tests
    .filter((t) => t.date >= today)
    .toSorted((a, b) => a.date.localeCompare(b.date))[0];
  const testIn = nextTest ? daysBetween(today, nextTest.date) : null;
  const testDay = nextTest
    ? new Date(`${nextTest.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" })
    : "";

  return (
    <main className="screen today g18">
      {demoBanner}
      <header className="today-head between rise" style={{ alignItems: "flex-end", gap: 12 }}>
        <div className="stack" style={{ gap: 8, minWidth: 0 }}>
          <div className="eyebrow">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
          <h1 className="h1">
            <Hello name={profile?.name} />
          </h1>
        </div>
        <div className="stack" style={{ gap: 8, alignItems: "flex-end", flex: "none" }}>
          <button
            className="avatar"
            aria-label={`Level ${lvl.level}, ${stats.xp} XP. Open More`}
            onClick={() => go("apps")}
          >
            {profile?.name?.trim() ? (
              profile.name.trim()[0].toUpperCase()
            ) : (
              <Icon name="user" size={20} />
            )}
          </button>
          {/* A "0 days" streak only discourages; it appears from the first day. */}
          {stats.streak > 0 && (
            <span className="chip streak" aria-label={`${stats.streak} day streak`}>
              <Icon name="flame" size={14} className="flame" />
              <CountUp n={stats.streak} /> {stats.streak === 1 ? "day" : "days"}
            </span>
          )}
        </div>
      </header>

      <NowCard />

      <Briefing />

      <nav className="bento-tiles rise d3" aria-label="Numbers">
        <button className="bento-tile" onClick={() => go("homework")}>
          <span className="eyebrow">Due today</span>
          <span className="big t-orange">
            <CountUp n={dueToday} />
          </span>
          <span className="s13 muted">
            {dueWeek > 0 ? `${dueWeek} more this week` : "Nothing else this week"}
          </span>
        </button>
        <button className="bento-tile" onClick={() => go("tests")}>
          <span className="eyebrow">Next test</span>
          {testIn === null ? (
            <span className="big t-pink">–</span>
          ) : (
            <span className="big t-pink">
              {testIn === 0 ? "Today" : testIn}
              {testIn > 0 && <small> {testIn === 1 ? "day" : "days"}</small>}
            </span>
          )}
          <span className="s13 muted">
            {nextTest ? `${nextTest.subject} · ${testDay}` : "None planned"}
          </span>
        </button>
      </nav>

      {next3.length > 0 && (
        <section className="card rows today-due rise d4" aria-label="Due next">
          <div className="between" style={{ padding: "14px 16px 4px" }}>
            <h2 className="h2">Due next</h2>
            <button className="text-link" onClick={() => go("homework")}>
              All {open.length}
            </button>
          </div>
          {next3.map((h) => (
            <button key={h.id} className="li" onClick={() => openAssignment(h)}>
              <span className="stack li-main" style={{ gap: 1 }}>
                <span className="li-title">{h.title}</span>
                <span className="s12 muted li-course">{h.course}</span>
              </span>
              <span className={`s13 due-when${isUrgent(h.due) ? " urgent" : ""}`}>
                {dueLabel(h.due)}
              </span>
            </button>
          ))}
        </section>
      )}

      {todoNext.length > 0 && (
        <section className="card rows today-due rise d4" aria-label="To-do">
          <div className="between" style={{ padding: "14px 16px 4px" }}>
            <h2 className="h2">To-do</h2>
            <button className="text-link" onClick={() => go("todo")}>
              All {todoOpen}
            </button>
          </div>
          {todoNext.map((t) => (
            <div
              key={t.id}
              className={settling.includes(t.id) ? "li todo-li ticked" : "li todo-li"}
            >
              <button
                className={settling.includes(t.id) ? "tick done" : "tick"}
                aria-label={settling.includes(t.id) ? `Done: ${t.text}` : `Tick off ${t.text}`}
                onClick={() => tickTodo(t.id)}
              />
              <button className="todo-li-open" onClick={() => go("todo")}>
                <span className="li-title">{t.text}</span>
                {t.due && (
                  <span className={`s13 due-when${t.due <= today ? " urgent" : ""}`}>
                    {t.due < today ? "Overdue" : t.due === today ? "Today" : dueLabel(t.due)}
                  </span>
                )}
              </button>
            </div>
          ))}
        </section>
      )}

      {upcoming.lessons.length > 0 && (
        <section className="card rows today-day rise d4">
          <div className="between" style={{ padding: "14px 16px 4px" }}>
            <h2 className="h2">{upcoming.label}</h2>
            <button className="text-link" onClick={() => go("timetable")}>
              Week
            </button>
          </div>
          {upcoming.lessons.map((l, i) => (
            <button
              key={`${l.day}-${l.start}`}
              className={`li${i >= 3 ? " extra" : ""}`}
              onClick={() => go("timetable")}
            >
              <span className="num li-time">{l.start}</span>
              <span className="li-main">{l.subject}</span>
              {l.room && <span className="s13 muted">Room {l.room}</span>}
            </button>
          ))}
        </section>
      )}

      {/* iPad and bigger only (bento.css): shortcuts fill the space under the brief. */}
      <nav className="tiles-grid quad today-shortcuts rise d5" aria-label="Shortcuts">
        {SHORTCUTS.map((t) => (
          <button key={t.screen} className="tile" onClick={() => go(t.screen)}>
            <span className={`ic tone-${t.tone}`} aria-hidden="true">
              <Icon name={t.icon} size={20} />
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <UnlockCard />
    </main>
  );
}
