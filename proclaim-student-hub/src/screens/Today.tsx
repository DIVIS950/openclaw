import { useEffect, useState } from "react";
import { AddAnythingButton } from "../components/AddAnything.tsx";
import { DaySummary } from "../components/DaySummary.tsx";
import { HomeworkRow } from "../components/HomeworkRow.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { planEvening, upcomingLessons, type Lesson, type PlanStep } from "../lib/aiFeatures.ts";
import { greeting, timeLabel } from "../lib/format.ts";
import { progress, timetable } from "../lib/store.ts";
import { subjectVars } from "../lib/subjects.ts";
import type { CalEvent } from "../lib/types.ts";
import { PAGES } from "../pages/runtime.ts";
import { UnlockCard } from "../pages/Unlock.tsx";

const QUICK_APPS: { name: string; url: string; icon: IconName; tile: string }[] = [
  { name: "Classroom", url: "https://classroom.google.com", icon: "classroom", tile: "#15803d" },
  { name: "Gmail", url: "https://mail.google.com", icon: "mail", tile: "#c2410c" },
  { name: "Dr Frost", url: "https://www.drfrost.org", icon: "frost", tile: "#0e7490" },
  { name: "Desmos", url: "https://student.desmos.com", icon: "graph", tile: "#2f6b22" },
];

export function Today() {
  const app = useApp();
  const { data, homework, profile, ai, go } = app;
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [plan, setPlan] = useState<PlanStep[] | "loading" | null>(null);
  const [lessons] = useState<Lesson[]>(timetable.get);
  const [stats] = useState(progress.get);
  const upcoming = upcomingLessons(lessons);

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
      <header className="between rise" style={{ alignItems: "flex-start" }}>
        <div className="stack" style={{ gap: 4 }}>
          <div className="eyebrow">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
          <h1 className="h1">
            {greeting()}
            {profile?.name ? `, ${profile.name}` : ""}
          </h1>
        </div>
        <div className="row">
          <AddAnythingButton onSaved={() => setSummaryVersion((v) => v + 1)} />
          {stats.streak > 0 && (
            <span className="chip warm" aria-label={`${stats.streak} day streak`}>
              <Icon name="flame" size={14} />
              {stats.streak}
            </span>
          )}
          <button className="round" aria-label="Apps and account" onClick={() => go("apps")}>
            {(profile?.name || "P").slice(0, 1).toUpperCase()}
          </button>
        </div>
      </header>

      <UnlockCard />

      <section className="card-dark stack rise" style={{ gap: 12, animationDelay: "0.08s" }}>
        <div
          className="between"
          style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}
        >
          <span className="row" style={{ gap: 6 }}>
            <Icon name="sparkle" size={16} className="wiggle" />
            Your day, summarised
          </span>
          {!data.demo && (
            <span className="row" style={{ gap: 4, color: "#fff" }}>
              <Icon name="sync" size={13} className="spin-slow" />
              Synced
            </span>
          )}
        </div>
        <DaySummary key={summaryVersion} />
        <div className="row">
          <button
            className="btn block"
            style={{ flex: 1 }}
            disabled={plan === "loading"}
            onClick={() => void makePlan()}
          >
            {plan === "loading" ? <Icon name="loader" size={16} className="spin" /> : null}
            Plan my evening
          </button>
          <button
            className="btn block"
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.18)",
              color: "#fff",
              borderColor: "rgba(255,255,255,0.45)",
              boxShadow: "none",
            }}
            onClick={() => go(PAGES ? "todo" : "inbox")}
          >
            {PAGES ? "My to-do" : "Read emails"}
          </button>
        </div>
      </section>

      {ai && (
        <button
          className="voice-cta rise"
          style={{ animationDelay: "0.12s" }}
          onClick={() => go("call")}
        >
          <span className="lab-cta-icon" aria-hidden="true">
            <Icon name="mic" size={22} />
          </span>
          <span className="stack" style={{ gap: 2, flex: 1 }}>
            <strong style={{ fontSize: 16 }}>Talk to your study buddy</strong>
            <span style={{ fontSize: 13 }}>
              Voice chat: explain, quiz me, practise Spanish or Czech
            </span>
          </span>
          <span aria-hidden="true" style={{ fontSize: 20 }}>
            ›
          </span>
        </button>
      )}

      {Array.isArray(plan) && (
        <section className="ai-card pop" aria-label="Your plan for this evening">
          <div className="between">
            <h3>
              <Icon name="sparkle" size={16} />
              Your plan for tonight · {plan.reduce((n, s) => n + s.minutes, 0)} min
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

      {upcoming.lessons.length > 0 ? (
        <section className="stack rise" style={{ animationDelay: "0.16s" }}>
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
            style={{ justifyContent: "flex-start", animationDelay: "0.16s" }}
            onClick={() => go("timetable")}
          >
            <Icon name="calendar" size={18} />
            <span style={{ flex: 1, textAlign: "left" }}>Add your timetable</span>›
          </button>
        )
      )}

      {events && events.length > 0 && (
        <section className="stack rise" style={{ animationDelay: "0.16s" }}>
          <h2 className="h2">Coming up</h2>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}
          >
            {events.slice(0, 3).map((e) => (
              <div key={e.id} className="card" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  {e.start.length > 10 ? timeLabel(e.start) : "All day"}
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.title}
                </div>
                {e.location && (
                  <div
                    className="muted"
                    style={{
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {e.location}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stack rise" style={{ animationDelay: "0.22s" }}>
        <div className="between">
          <h2 className="h2">Due soon</h2>
          <button className="link-btn" onClick={() => go("homework")}>
            See all
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

      <button
        className="lab-cta pop"
        style={{ animationDelay: "0.3s" }}
        onClick={() => go("revise")}
      >
        <span className="lab-cta-icon" aria-hidden="true">
          <Icon name="camera" size={22} />
        </span>
        <span className="stack" style={{ gap: 2, flex: 1, textAlign: "left" }}>
          <strong style={{ fontSize: 16 }}>Revision Lab</strong>
          <span className="muted">Scan a test or notes into flashcards, quizzes and games</span>
        </span>
        <span className="muted" style={{ fontSize: 20 }}>
          ›
        </span>
      </button>

      <button
        className="lab-cta pop"
        style={{ animationDelay: "0.33s" }}
        onClick={() => go("tutoring")}
      >
        <span className="lab-cta-icon" aria-hidden="true">
          <Icon name="book" size={22} />
        </span>
        <span className="stack" style={{ gap: 2, flex: 1, textAlign: "left" }}>
          <strong style={{ fontSize: 16 }}>Tutoring</strong>
          <span className="muted">Your tutors, Meet and WhatsApp, their material and homework</span>
        </span>
        <span className="muted" style={{ fontSize: 20 }}>
          ›
        </span>
      </button>

      <section className="stack rise" style={{ animationDelay: "0.36s" }}>
        <div className="between">
          <h2 className="h2">Quick apps</h2>
          <button className="link-btn" onClick={() => go("apps")}>
            All apps ›
          </button>
        </div>
        <div className="quick-apps">
          {QUICK_APPS.map((a) => (
            <a
              key={a.name}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="quick-app"
            >
              <span
                className="tile-icon"
                style={{ "--tile": a.tile } as React.CSSProperties}
                aria-hidden="true"
              >
                <Icon name={a.icon} size={24} />
              </span>
              {a.name}
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
