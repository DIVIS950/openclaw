import { useEffect, useState } from "react";
import { HomeworkRow } from "../components/HomeworkRow.tsx";
import { Icon } from "../components/Icon.tsx";
import { ImportSheet } from "../components/ImportSheet.tsx";
import { useAiContext, useApp } from "../context.ts";
import { planEvening, upcomingLessons, type Lesson, type PlanStep } from "../lib/aiFeatures.ts";
import { greeting, timeLabel } from "../lib/format.ts";
import { timetable } from "../lib/store.ts";
import type { CalEvent } from "../lib/types.ts";

const BRIEF_KEY = "psh.brief";

export function Today() {
  const app = useApp();
  const { data, homework, profile, ai, go } = app;
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [briefFailed, setBriefFailed] = useState(false);
  const [plan, setPlan] = useState<PlanStep[] | "loading" | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>(timetable.get);
  const [importing, setImporting] = useState(false);
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
    `Today screen. Summary: ${brief ?? ""}. Homework still to do: ` +
      open
        .map((h) => `${h.title} (${h.course}, due ${h.due?.slice(0, 10) ?? "no date"})`)
        .join("; "),
  );

  // Ask the AI for a short summary once the homework has loaded. Cached for the
  // session so switching tabs doesn't cost another call.
  useEffect(() => {
    if (!homework || !events) {
      return;
    }
    if (!ai) {
      const next = open[0];
      setBrief(
        open.length === 0
          ? "Nothing due right now. Nice one!"
          : `You have ${open.length} things to do. Next up: ${next.title} (${next.course}).`,
      );
      return;
    }
    const cacheKey = `${open.map((h) => h.id).join(",")}|${new Date().toDateString()}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(BRIEF_KEY) ?? "null") as {
        key: string;
        text: string;
      } | null;
      if (cached?.key === cacheKey) {
        setBrief(cached.text);
        return;
      }
    } catch {
      // Ignore a broken cache.
    }
    let cancelled = false;
    (async () => {
      try {
        const emails = await data.inbox().catch(() => []);
        const text = await ai.brief({
          name: profile?.name ?? "",
          homework: open
            .slice(0, 12)
            .map((h) => ({ title: h.title, course: h.course, due: h.due })),
          emails: emails
            .filter((e) => e.unread)
            .slice(0, 8)
            .map((e) => ({ from: e.from, subject: e.subject })),
          events: [
            ...events.map((e) => ({ title: e.title, start: e.start })),
            ...upcoming.lessons.map((l) => ({
              title: l.subject,
              start: `${upcoming.label} ${l.start}`,
            })),
          ],
        });
        if (!cancelled) {
          setBrief(text);
          sessionStorage.setItem(BRIEF_KEY, JSON.stringify({ key: cacheKey, text }));
        }
      } catch {
        if (!cancelled) {
          setBriefFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [homework, events, ai]);

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
        <button
          className="round"
          aria-label="Apps and account"
          onClick={() => go("apps")}
          style={{ fontWeight: 600 }}
        >
          {(profile?.name || "P").slice(0, 1).toUpperCase()}
        </button>
      </header>

      <section className="card-dark stack rise" style={{ gap: 12, animationDelay: "0.08s" }}>
        <div className="between" style={{ fontSize: 13, fontWeight: 600, color: "#c9d1f7" }}>
          <span className="row" style={{ gap: 6 }}>
            <Icon name="sparkle" size={16} className="wiggle" />
            Your day, summarised
          </span>
          {!data.demo && (
            <span className="row" style={{ gap: 4, color: "#a9e2b8" }}>
              <Icon name="sync" size={13} className="spin-slow" />
              Synced
            </span>
          )}
        </div>
        {brief ? (
          <p
            className="pop"
            style={{ margin: 0, fontFamily: "var(--serif)", fontSize: 19, lineHeight: 1.4 }}
          >
            {brief}
          </p>
        ) : briefFailed ? (
          <p style={{ margin: 0, fontSize: 15 }}>
            Couldn't write your summary right now. Your homework is below.
          </p>
        ) : (
          <div className="stack" style={{ gap: 8 }} aria-label="Loading summary">
            <div className="skeleton" />
            <div className="skeleton" style={{ width: "70%" }} />
          </div>
        )}
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
              background: "transparent",
              color: "var(--bg)",
              borderColor: "#5c584f",
            }}
            onClick={() => go("inbox")}
          >
            Read emails
          </button>
        </div>
      </section>

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

      {events && events.length === 0 && upcoming.lessons.length > 0 && (
        <section className="stack rise" style={{ animationDelay: "0.16s" }}>
          <div className="between">
            <h2 className="h2">Next lessons · {upcoming.label}</h2>
            <button
              className="link-btn"
              style={{ minHeight: 32 }}
              onClick={() => setImporting(true)}
            >
              Update
            </button>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}
          >
            {upcoming.lessons.slice(0, 3).map((l, i) => (
              <div key={i} className="card" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  {l.start}
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {l.subject}
                </div>
                {l.room && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {l.room}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {events && events.length === 0 && lessons.length === 0 && !data.demo && (
        <button
          className="btn block rise"
          style={{ justifyContent: "flex-start", animationDelay: "0.16s" }}
          onClick={() => setImporting(true)}
        >
          <Icon name="calendar" size={18} />
          <span style={{ flex: 1, textAlign: "left" }}>Add your timetable from a photo</span>›
        </button>
      )}

      {importing && (
        <ImportSheet mode="timetable" onClose={() => setImporting(false)} onLessons={setLessons} />
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
        className="btn big block pop"
        style={{
          justifyContent: "flex-start",
          background: "var(--accent-soft)",
          color: "var(--accent-ink)",
          border: "none",
          animationDelay: "0.3s",
        }}
        onClick={() => go("revise")}
      >
        <Icon name="camera" size={22} />
        <span style={{ flex: 1, textAlign: "left" }}>
          Revision Lab: scan a test or notes → games
        </span>
        ›
      </button>
    </main>
  );
}
