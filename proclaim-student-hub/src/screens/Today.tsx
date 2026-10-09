import { useState } from "react";
import { Briefing } from "../components/Briefing.tsx";
import { CountUp } from "../components/CountUp.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import { NowCard } from "../components/NowCard.tsx";
import { WeeklyReport } from "../components/WeeklyReport.tsx";
import { useAiContext, useApp, type Screen } from "../context.ts";
import { upcomingLessons, type Lesson } from "../lib/aiFeatures.ts";
import { greeting } from "../lib/format.ts";
import { level, progress, timetable } from "../lib/store.ts";
import { UnlockCard } from "../pages/Unlock.tsx";
import { AiKeyCard } from "../pages/WebVersion.tsx";

// Today, as on the canvas: greeting, the AI briefing, the lesson on now with
// its countdown ring, what's next, four tiles, the week's report card.

const TILES: { screen: Screen; label: string; icon: IconName; tint: string }[] = [
  { screen: "revise", label: "Revise", icon: "flask", tint: "violet" },
  { screen: "inbox", label: "Inbox", icon: "mail", tint: "cyan" },
  { screen: "tutoring", label: "Tutoring", icon: "video", tint: "magenta" },
  { screen: "todo", label: "To-do", icon: "checkSquare", tint: "lime" },
];

export function Today({ demoBanner }: { demoBanner?: React.ReactNode }) {
  const app = useApp();
  const { homework, profile, go } = app;
  const [lessons] = useState<Lesson[]>(timetable.get);
  const [stats] = useState(progress.get);
  const upcoming = upcomingLessons(lessons);
  const lvl = level(stats.xp);

  const open = (homework ?? []).filter((h) => !h.done);
  useAiContext(
    "Today screen. Homework still to do: " +
      open
        .map((h) => `${h.title} (${h.course}, due ${h.due?.slice(0, 10) ?? "no date"})`)
        .join("; "),
  );
  // "Next": the rest of today, or the next school day when today is over.
  const next = upcoming.lessons.slice(0, upcoming.label === "Today" ? 3 : 2);

  return (
    <main className="screen g20">
      {demoBanner}
      <header className="between rise" style={{ alignItems: "flex-end", gap: 12 }}>
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <div className="eyebrow">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
          <h1 className="h1">{profile?.name ? `Hey ${profile.name.split(" ")[0]}` : greeting()}</h1>
        </div>
        <div className="head-chips">
          <button
            className="chip violet"
            aria-label={`Level ${lvl.level}, ${stats.xp} XP`}
            onClick={() => go("revise")}
          >
            LV {lvl.level}
          </button>
          <span className="chip lime" aria-label={`${stats.streak} day streak`}>
            <Icon name="flame" size={14} className={stats.streak > 0 ? "flame" : undefined} />
            <CountUp n={stats.streak} /> {stats.streak === 1 ? "day" : "days"}
          </span>
        </div>
      </header>

      <Briefing />

      <NowCard />

      {next.length > 0 && (
        <section className="stack rise d3" style={{ gap: 10 }}>
          <div className="between" style={{ alignItems: "center" }}>
            <h2 className="h2">{upcoming.label === "Today" ? "Next" : upcoming.label}</h2>
            <button
              className="btn link s12"
              style={{ minHeight: 28 }}
              onClick={() => go("timetable")}
            >
              Full day
            </button>
          </div>
          <div className="card rows">
            {next.map((l, i) => (
              <button key={`${l.day}-${l.start}`} className="crow" onClick={() => go("timetable")}>
                <span className={`tl${i === 0 ? " live" : ""}`} aria-hidden="true" />
                <span className="num s13" style={{ width: 48, flex: "none" }}>
                  {l.start}
                </span>
                <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700 }}>{l.subject}</span>
                  <span className="s12 muted">
                    {[l.room ? `Room ${l.room}` : "", l.end ? `until ${l.end}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {i === 0 && <span className="chip lime">Next</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      <nav className="tiles-grid quad rise d4" aria-label="Shortcuts">
        {TILES.map((t) => (
          <button key={t.screen} className="tile" onClick={() => go(t.screen)}>
            <span className={`ico ${t.tint}`} aria-hidden="true">
              <Icon name={t.icon} size={18} />
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <WeeklyReport />
      <UnlockCard />
      <AiKeyCard />
    </main>
  );
}
