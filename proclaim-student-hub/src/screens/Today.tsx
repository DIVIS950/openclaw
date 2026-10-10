import { useState } from "react";
import { Briefing } from "../components/Briefing.tsx";
import { CountUp } from "../components/CountUp.tsx";
import { Icon } from "../components/Icon.tsx";
import { NowCard } from "../components/NowCard.tsx";
import { useAiContext, useApp } from "../context.ts";
import { upcomingLessons, type Lesson } from "../lib/aiFeatures.ts";
import { greeting } from "../lib/format.ts";
import { level, progress, timetable } from "../lib/store.ts";
import { addDays, dayOf, daysBetween, prepTests } from "../lib/study.ts";
import { UnlockCard } from "../pages/Unlock.tsx";
import { AiKeyCard } from "../pages/WebVersion.tsx";

// Today, as on the Bento canvas: greeting, the lesson on now (accent hero),
// the daily brief, two big numbers (due today, next test) and the rest of the
// day. On a wide screen the same blocks become a grid with the day down the
// right-hand side (bento.css). The week's report lives in More.

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
  const { homework, profile, go } = app;
  const [lessons] = useState<Lesson[]>(timetable.get);
  const [stats] = useState(progress.get);
  const [tests] = useState(prepTests.all);
  const upcoming = upcomingLessons(lessons);
  const lvl = level(stats.xp);

  const open = (homework ?? []).filter((h) => !h.done);
  useAiContext(
    "Today screen. Homework still to do: " +
      open
        .map((h) => `${h.title} (${h.course}, due ${h.due?.slice(0, 10) ?? "no date"})`)
        .join("; "),
  );

  // The two big numbers: homework due today, and days to the next test.
  const today = dayOf(new Date());
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
            {(profile?.name?.trim()[0] ?? "J").toUpperCase()}
          </button>
          <span className="chip streak" aria-label={`${stats.streak} day streak`}>
            <Icon name="flame" size={14} className={stats.streak > 0 ? "flame" : undefined} />
            <CountUp n={stats.streak} /> {stats.streak === 1 ? "day" : "days"}
          </span>
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

      {upcoming.lessons.length > 0 && (
        <section className="card rows today-day rise d4">
          <div className="between" style={{ padding: "14px 16px 4px" }}>
            <h2 className="h2">{upcoming.label === "Today" ? "Later today" : upcoming.label}</h2>
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

      <UnlockCard />
      <AiKeyCard />
    </main>
  );
}
