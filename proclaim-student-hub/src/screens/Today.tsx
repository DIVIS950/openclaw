import { useEffect, useState } from "react";
import { AddAnythingButton } from "../components/AddAnything.tsx";
import { DaySummary } from "../components/DaySummary.tsx";
import { HomeworkRow } from "../components/HomeworkRow.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import { NowCard } from "../components/NowCard.tsx";
import { WeeklyReport } from "../components/WeeklyReport.tsx";
import { WeekPlan } from "../components/WeekPlan.tsx";
import { useAiContext, useApp, type Screen } from "../context.ts";
import { planEvening, upcomingLessons, type Lesson, type PlanStep } from "../lib/aiFeatures.ts";
import { greeting, timeLabel } from "../lib/format.ts";
import { level, progress, timetable } from "../lib/store.ts";
import { tutoring } from "../lib/study.ts";
import { subjectVars } from "../lib/subjects.ts";
import { lessonLabel, upcomingTutoring } from "../lib/tutorSchedule.ts";
import type { CalEvent } from "../lib/types.ts";
import { gmailLink } from "../pages/gmailLink.ts";
import { PAGES } from "../pages/runtime.ts";
import { UnlockCard } from "../pages/Unlock.tsx";
import { AiKeyCard } from "../pages/WebVersion.tsx";

// Today: one glanceable dashboard. The dark hero holds the AI summary and the
// two AI planners; six yellow tiles open everything else in one tap.

// Each tile gets its own tint so the grid reads at a glance.
const TILES: {
  screen: Screen;
  label: string;
  sub: string;
  icon: IconName;
  tint: string;
  needsAi?: boolean;
}[] = [
  {
    screen: "call",
    label: "Talk",
    sub: "Voice study buddy",
    icon: "mic",
    tint: "var(--accent)",
    needsAi: true,
  },
  {
    screen: "revise",
    label: "Revision Lab",
    sub: "Scan → flashcards",
    icon: "camera",
    tint: "var(--warm)",
  },
  { screen: "inbox", label: "Inbox", sub: "School email", icon: "mail", tint: "#22ff77" },
  { screen: "tutoring", label: "Tutoring", sub: "Tutors & lessons", icon: "book", tint: "#b026ff" },
  {
    screen: "timetable",
    label: "Timetable",
    sub: "Lessons & calendar",
    icon: "calendar",
    tint: "var(--accent)",
  },
  { screen: "apps", label: "Apps", sub: "Classroom, Dr Frost…", icon: "apps", tint: "#ff2ec4" },
];

const TILE_NAMES: Partial<Record<Screen, string>> = {
  call: "Talk to your study buddy",
  apps: "All apps",
};

export function Today() {
  const app = useApp();
  const { data, homework, profile, ai, go } = app;
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [plan, setPlan] = useState<PlanStep[] | "loading" | null>(null);
  const [week, setWeek] = useState(false);
  const [lessons] = useState<Lesson[]>(timetable.get);
  const [stats] = useState(progress.get);
  const upcoming = upcomingLessons(lessons);
  const lvl = level(stats.xp);
  const [nextTutor] = useState(() => upcomingTutoring(tutoring.tutors())[0]);

  const makePlan = async () => {
    if (!ai) {
      app.toast("The AI needs you signed in.");
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

  useEffect(() => {
    data.events().then(setEvents, (err: unknown) => {
      setEvents([]);
      app.handleError(err);
    });
    // Only when the data source changes.
  }, [data]);

  const open = (homework ?? []).filter((h) => !h.done);
  useAiContext(
    "Today screen. Homework still to do: " +
      open
        .map((h) => `${h.title} (${h.course}, due ${h.due?.slice(0, 10) ?? "no date"})`)
        .join("; "),
  );

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 2 }}>
        <div className="between">
          <div className="eyebrow">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
          <div className="row">
            <AddAnythingButton onSaved={() => setSummaryVersion((v) => v + 1)} />
            <button
              className="level-pill"
              aria-label={`Level ${lvl.level}, ${stats.xp} XP${stats.streak ? `, ${stats.streak} day streak` : ""}`}
              onClick={() => go("apps")}
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
          </div>
        </div>
        <h1 className="h1">
          {greeting()}
          {profile?.name ? `, ${profile.name}` : ""}
        </h1>
      </header>

      <UnlockCard />
      <NowCard />
      <AiKeyCard />

      <section className="card stack rise hero" style={{ gap: 12, animationDelay: "0.05s" }}>
        <div className="between hero-label">
          <span className="row ai" style={{ gap: 6 }}>
            <Icon name="sparkle" size={16} className="wiggle" />
            Your day
          </span>
          {!data.demo && (
            <span className="row" style={{ gap: 4 }}>
              <Icon name="sync" size={13} className="spin-slow" />
              Synced
            </span>
          )}
        </div>
        <DaySummary key={summaryVersion} />
        {ai && (
          <div className="row">
            <button
              className="btn block primary hero-btn"
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
            <button
              className="btn block soft hero-btn"
              style={{ flex: 1 }}
              disabled={week}
              onClick={() => setWeek(true)}
            >
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
            <div
              key={i}
              className="row rise"
              style={{ alignItems: "flex-start", gap: 10, animationDelay: `${i * 0.06}s` }}
            >
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

      <WeeklyReport />

      <nav className="tiles-grid rise" style={{ animationDelay: "0.1s" }} aria-label="Shortcuts">
        {TILES.filter((t) => !t.needsAi || ai).map((t, i) => (
          <button
            key={t.screen}
            className="quick-tile pop"
            style={
              { "--tile": t.tint, animationDelay: `${0.12 + i * 0.04}s` } as React.CSSProperties
            }
            aria-label={TILE_NAMES[t.screen] ?? t.label}
            onClick={() =>
              go(t.screen === "inbox" && PAGES && !gmailLink.granted ? "todo" : t.screen)
            }
          >
            <span className="quick-tile-icon" aria-hidden="true">
              <Icon name={t.icon} size={22} />
            </span>
            <strong>{t.label}</strong>
            <span>
              {t.screen === "tutoring" && nextTutor
                ? `${nextTutor.tutor.name} ${lessonLabel(nextTutor.start)}`
                : t.sub}
            </span>
          </button>
        ))}
      </nav>

      {upcoming.lessons.length > 0 ? (
        <section className="stack rise" style={{ animationDelay: "0.18s" }}>
          <div className="between">
            <h2 className="h2">Next lessons · {upcoming.label}</h2>
            <button className="link-btn" onClick={() => go("timetable")}>
              Timetable ›
            </button>
          </div>
          <div className="lesson-strip">
            {upcoming.lessons.slice(0, 6).map((l, i) => (
              <button
                key={i}
                className="lesson-chip pop"
                style={{ ...subjectVars(l.subject), animationDelay: `${0.2 + i * 0.05}s` }}
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
      ) : (
        lessons.length === 0 && (
          <button
            className="btn big block rise"
            style={{ justifyContent: "flex-start", animationDelay: "0.18s" }}
            onClick={() => go("timetable")}
          >
            <Icon name="calendar" size={18} />
            <span style={{ flex: 1, textAlign: "left" }}>Add your timetable</span>›
          </button>
        )
      )}

      {events && events.length > 0 && (
        <section className="stack rise" style={{ animationDelay: "0.2s" }}>
          <h2 className="h2">Coming up</h2>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}
          >
            {events.slice(0, 3).map((e) => (
              <div key={e.id} className="card" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  {e.start.length > 10 ? timeLabel(e.start) : "All day"}
                </div>
                <div className="clip" style={{ fontWeight: 600 }}>
                  {e.title}
                </div>
                {e.location && (
                  <div className="muted clip" style={{ fontSize: 12 }}>
                    {e.location}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stack rise" style={{ animationDelay: "0.24s" }}>
        <div className="between">
          <h2 className="h2">Due soon</h2>
          <button className="link-btn" onClick={() => go("homework")}>
            See all ›
          </button>
        </div>
        {homework === null ? (
          <div className="card stack">
            <div className="skeleton light" />
            <div className="skeleton light" style={{ width: "60%" }} />
          </div>
        ) : open.length === 0 ? (
          <div className="card empty">All done. Nothing due!</div>
        ) : (
          <div className="list">
            {open.slice(0, 3).map((hw) => (
              <HomeworkRow key={hw.id} hw={hw} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
