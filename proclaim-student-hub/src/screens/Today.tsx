import { useEffect, useState } from "react";
import { HomeworkRow } from "../components/HomeworkRow.tsx";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { greeting, timeLabel } from "../lib/format.ts";
import type { CalEvent } from "../lib/types.ts";

const BRIEF_KEY = "psh.brief";

export function Today() {
  const app = useApp();
  const { data, homework, profile, ai, go } = app;
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [briefFailed, setBriefFailed] = useState(false);

  useEffect(() => {
    data.events().then(setEvents, (err: unknown) => {
      setEvents([]);
      app.handleError(err);
    });
    // Only when the data source changes.
  }, [data]);

  const open = (homework ?? []).filter((h) => !h.done);

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
          events: events.map((e) => ({ title: e.title, start: e.start })),
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
            onClick={() => app.askTutor("Help me plan my homework for this evening.")}
          >
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
        <span style={{ flex: 1, textAlign: "left" }}>Post your notes → revision + games</span>›
      </button>
    </main>
  );
}
