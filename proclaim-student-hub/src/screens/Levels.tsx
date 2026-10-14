import { useState } from "react";
import { BackButton } from "../components/BackButton.tsx";
import { Icon } from "../components/Icon.tsx";
import { useAiContext } from "../context.ts";
import { badgeStates, levelTitle } from "../lib/badges.ts";
import { level, localDay, progress, totals, weekLog } from "../lib/store.ts";

// Levels & badges: level, XP to the next one, streak, this week's XP and every badge.

const DAYS = 7;

export function Levels() {
  const [p] = useState(progress.get);
  const [t] = useState(totals.get);
  const states = badgeStates(t, p);
  const l = level(p.xp);
  const earned = states.filter((s) => s.earned).length;

  // XP per day for the last week, oldest first.
  const log = weekLog.all();
  const week = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (DAYS - 1 - i));
    const day = localDay(d);
    return {
      day,
      label: d.toLocaleDateString("en-GB", { weekday: "narrow" }),
      xp: log.filter((e) => e.day === day && e.kind === "xp").reduce((n, e) => n + e.n, 0),
    };
  });
  const top = Math.max(10, ...week.map((w) => w.xp));
  useAiContext(
    `Level ${l.level} (${levelTitle(l.level)}), ${p.xp} XP, ${l.next} XP to next level, streak ${p.streak} days, ${earned} of ${states.length} badges.`,
  );

  return (
    <main className="screen levels-screen">
      <BackButton />
      <header className="rise">
        <h1 className="h1">Levels & badges</h1>
      </header>

      <section className="card level-hero rise d1" aria-label="Your level">
        <span
          className="level-ring"
          style={{ "--fill": l.percent / 100 } as React.CSSProperties}
          aria-hidden="true"
        >
          <span className="level-num">{l.level}</span>
        </span>
        <span className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <span className="eyebrow">Level {l.level}</span>
          <span className="h2">{levelTitle(l.level)}</span>
          <span className="xp-bar" aria-label={`${l.percent}% of the way to level ${l.level + 1}`}>
            <span style={{ width: `${l.percent}%` }} />
          </span>
          <span className="s13 muted">
            {p.xp} XP · {l.next} XP to level {l.level + 1}
          </span>
        </span>
      </section>

      <section className="level-stats rise d2">
        <div className="card stat">
          <Icon name="flame" size={20} />
          <span className="big-num">{p.streak}</span>
          <span className="s12 muted">day streak</span>
        </div>
        <div className="card stat">
          <Icon name="trophy" size={20} />
          <span className="big-num">
            {earned}/{states.length}
          </span>
          <span className="s12 muted">badges</span>
        </div>
        <div className="card stat">
          <Icon name="star" size={20} />
          <span className="big-num">{Math.max(t.best ?? 0, p.streak)}</span>
          <span className="s12 muted">best streak</span>
        </div>
      </section>

      <section className="card rise d2" aria-label="XP this week">
        <span className="eyebrow">XP this week</span>
        <div className="xp-week">
          {week.map((w) => (
            <span key={w.day} className="xp-col" title={`${w.xp} XP`}>
              <span className="xp-val s11 muted">{w.xp || ""}</span>
              <span
                className="xp-stick"
                style={{ height: `${Math.max(4, (w.xp / top) * 100)}%` }}
              />
              <span className="s11 muted">{w.label}</span>
            </span>
          ))}
        </div>
        <p className="s12 muted" style={{ margin: 0 }}>
          XP: homework +5 · focus +10 · revision cards · bag packed +5 · evening plan +10 · to-dos
          +2
        </p>
      </section>

      <section className="stack rise d3" style={{ gap: 8 }}>
        <h2 className="eyebrow" style={{ paddingLeft: 4, margin: 0 }}>
          Badges
        </h2>
        <div className="badge-grid">
          {states.map((s) => (
            <div
              key={s.badge.id}
              className={`card badge${s.earned ? " earned" : ""}`}
              aria-label={`${s.badge.name}: ${s.badge.detail}${s.earned ? ", earned" : `, ${s.have} of ${s.badge.goal}`}`}
            >
              <span
                className={`badge-ic tone-${s.earned ? s.badge.tone : "grey"}`}
                aria-hidden="true"
              >
                <Icon name={s.earned ? s.badge.icon : "lock"} size={22} />
              </span>
              <strong className="s13">{s.badge.name}</strong>
              <span className="s11 muted">{s.badge.detail}</span>
              {!s.earned && (
                <span className="badge-bar" aria-hidden="true">
                  <span style={{ width: `${(s.have / s.badge.goal) * 100}%` }} />
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
