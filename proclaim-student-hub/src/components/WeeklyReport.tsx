import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../context.ts";
import { isWeak } from "../lab/model.ts";
import { labPacks } from "../lab/store.ts";
import { bySubject, grades } from "../lib/grades.ts";
import { progress, weekLog } from "../lib/store.ts";
import { daysBetween, dayOf, prepTests } from "../lib/study.ts";
import { weeklyReport, weekStats, type WeekReport, type WeekStats } from "../lib/weekly.ts";
import { Icon } from "./Icon.tsx";

// "Your week": the numbers at a glance on Today, and a full report sheet with
// a few honest lines from the AI about what went well and what to do next.

export function WeeklyReport() {
  const [open, setOpen] = useState(false);
  const [stats] = useState(() => weekStats(weekLog.all(), dayOf(new Date())));
  const quiet = stats.xp === 0 && stats.homework === 0 && stats.cards === 0;
  return (
    <>
      <button className="card week-card rise" onClick={() => setOpen(true)} aria-label="Your week">
        <span className="stack" style={{ gap: 2, flex: 1, alignItems: "flex-start" }}>
          <span className="eyebrow">Your week</span>
          {quiet ? (
            <strong>Nothing logged yet. Do one thing and it shows here.</strong>
          ) : (
            <span className="row week-nums" style={{ flexWrap: "wrap", gap: 10 }}>
              <strong>{stats.xp} XP</strong>
              <span>{stats.homework} homework</span>
              <span>{stats.cards} cards</span>
              {stats.focus > 0 && <span>{stats.focus} min focus</span>}
            </span>
          )}
        </span>
        <span className="muted">Report ›</span>
      </button>
      {open && <WeekSheet stats={stats} onClose={() => setOpen(false)} />}
    </>
  );
}

function WeekSheet({ stats, onClose }: { stats: WeekStats; onClose: () => void }) {
  const { ai, profile, handleError } = useApp();
  const [report, setReport] = useState<WeekReport | "loading" | null>(ai ? "loading" : null);
  const today = dayOf(new Date());

  useEffect(() => {
    if (!ai) {
      return;
    }
    const packs = labPacks.all();
    const tests = prepTests
      .all()
      .map((t) => ({ topic: `${t.subject}: ${t.topic}`, days: daysBetween(today, t.date) }))
      .filter((t) => t.days >= 0 && t.days <= 10);
    weeklyReport(ai, stats, {
      name: profile?.name ?? "",
      streak: progress.get().streak,
      weakSpots: packs.reduce((n, p) => n + p.items.filter(isWeak).length, 0),
      testsSoon: tests,
      gradesAvg: bySubject(grades.all()).map((g) => ({ subject: g.subject, average: g.average })),
    }).then(setReport, (err: unknown) => {
      setReport(null);
      handleError(err);
    });
    // Once per opening.
  }, []);

  const host = document.querySelector(".app") ?? document.body;
  const range = `${stats.from.slice(8)}/${stats.from.slice(5, 7)} – ${stats.to.slice(8)}/${stats.to.slice(5, 7)}`;
  return createPortal(
    <div className="backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Weekly report"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="between">
          <div className="stack" style={{ gap: 2 }}>
            <span className="eyebrow">Weekly report · {range}</span>
            <h2 className="h1" style={{ fontSize: 24 }}>
              Your week
            </h2>
          </div>
          <button className="round" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="week-grid">
          <Stat n={stats.xp} label="XP" sub={stats.lastXp ? `last week ${stats.lastXp}` : ""} />
          <Stat n={stats.homework} label="homework done" />
          <Stat n={stats.cards} label="cards practised" />
          <Stat n={stats.todos} label="to-dos ticked" />
          <Stat n={stats.focus} label="focus minutes" />
          <Stat n={stats.activeDays} label="active days" sub="of 7" />
        </div>
        {report === "loading" && (
          <div className="stack" aria-label="Writing your report">
            <div className="skeleton light" />
            <div className="skeleton light" style={{ width: "70%" }} />
          </div>
        )}
        {report && report !== "loading" && (
          <section className="ai-card pop">
            <h3>
              <Icon name="sparkle" size={16} />
              {report.headline}
            </h3>
            {report.wins.length > 0 && (
              <div className="stack" style={{ gap: 4 }}>
                <span className="eyebrow">Went well</span>
                <ul className="ai-list">
                  {report.wins.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {report.next.length > 0 && (
              <div className="stack" style={{ gap: 4 }}>
                <span className="eyebrow">Next week</span>
                <ul className="ai-list">
                  {report.next.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
        {!ai && (
          <p className="muted" style={{ margin: 0 }}>
            Add the AI key to get a written report with what to do next week.
          </p>
        )}
      </div>
    </div>,
    host,
  );
}

function Stat({ n, label, sub }: { n: number; label: string; sub?: string }) {
  return (
    <div className="hw-stat">
      <strong>{n}</strong>
      <span>{label}</span>
      {sub && <span style={{ fontSize: 11 }}>{sub}</span>}
    </div>
  );
}
