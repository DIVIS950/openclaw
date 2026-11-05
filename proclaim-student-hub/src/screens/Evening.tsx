import { useMemo, useState } from "react";
import { BackButton } from "../components/BackButton.tsx";
import { FocusButton } from "../components/FocusTimer.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { isDue } from "../lab/model.ts";
import { labPacks } from "../lab/store.ts";
import {
  buildEvening,
  evening,
  hhmm,
  toMin,
  type Block,
  type BlockKind,
  type EveningSettings,
} from "../lib/evening.ts";
import { dayOf, prepTests, testHandoff, todos, tutoring } from "../lib/study.ts";
import { upcomingTutoring } from "../lib/tutorSchedule.ts";

// Plan my evening: tonight in time blocks. Tick each block; finish them all for +10 XP.

const KIND: Record<BlockKind, { icon: IconName; tone: string }> = {
  homework: { icon: "homework", tone: "orange" },
  test: { icon: "timer", tone: "pink" },
  revise: { icon: "flask", tone: "violet" },
  todo: { icon: "checkSquare", tone: "green" },
  tutor: { icon: "users", tone: "blue" },
  break: { icon: "moon", tone: "grey" },
  dinner: { icon: "sun", tone: "yellow" },
};

const WORK = new Set<BlockKind>(["homework", "test", "revise", "todo"]);

export function Evening() {
  const { homework, go, openAssignment, toast, ai } = useApp();
  const [now] = useState(() => new Date());
  const today = dayOf(now);
  const [settings, setSettings] = useState<EveningSettings>(evening.settings);
  const [editing, setEditing] = useState(false);
  const [ticks, setTicks] = useState<string[]>(() => evening.ticks(today));
  const [tip, setTip] = useState<string | null>(null);

  const plan = useMemo(() => {
    const labDue = labPacks
      .all()
      .reduce((n, p) => n + p.items.filter((i) => isDue(i, today)).length, 0);
    return buildEvening({
      now,
      homework: homework ?? [],
      tests: prepTests.all(),
      todos: todos.all(),
      labDue,
      tutoring: upcomingTutoring(tutoring.tutors(), now).map((u) => ({
        start: u.start,
        name: u.tutor.name,
        subject: u.tutor.subject,
      })),
      settings,
    });
  }, [homework, now, settings, today]);

  const work = plan.blocks.filter((b) => WORK.has(b.kind));
  const doneWork = work.filter((b) => ticks.includes(b.id)).length;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const current = plan.blocks.find((b) => nowMin >= b.start && nowMin < b.start + b.mins);
  useAiContext(
    `Tonight's plan: ${plan.blocks.map((b) => `${hhmm(b.start)} ${b.title} (${b.mins} min)${ticks.includes(b.id) ? " done" : ""}`).join("; ")}`,
  );

  const toggle = (b: Block) => {
    const next = ticks.includes(b.id) ? evening.untick(today, b.id) : evening.tick(today, b.id);
    setTicks(next);
    if (work.length > 0 && work.every((w) => next.includes(w.id)) && evening.finished(today)) {
      toast("Evening plan finished +10 XP");
    }
  };

  const open = (b: Block) => {
    if (b.kind === "homework" && b.ref) {
      const hw = homework?.find((h) => h.id === b.ref);
      if (hw) {
        openAssignment(hw);
      }
    } else if (b.kind === "test" && b.ref) {
      testHandoff.set(b.ref);
      go("tests");
    } else if (b.kind === "revise") {
      go("revise");
    } else if (b.kind === "todo") {
      go("todo");
    } else if (b.kind === "tutor") {
      go("tutoring");
    }
  };

  const askTip = async () => {
    if (!ai) {
      return;
    }
    setTip("…");
    try {
      const text = await ai.text(
        `You coach a Year 9 student. Here is their evening plan:\n${plan.blocks
          .map((b) => `${hhmm(b.start)} ${b.title} (${b.mins} min)`)
          .join(
            "\n",
          )}\n${plan.leftOver.length ? `Didn't fit: ${plan.leftOver.map((t) => t.title).join(", ")}\n` : ""}Give ONE short, friendly, practical tip for tonight (max 2 sentences, no lists).`,
        { quick: true },
      );
      setTip(text.trim());
    } catch {
      setTip(null);
      toast("The AI tip didn't come through. Try again in a moment.");
    }
  };

  const setTime = (key: keyof EveningSettings, value: string) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    evening.saveSettings(next);
  };

  return (
    <main className="screen evening-screen">
      <BackButton />
      <header className="rise">
        <h1 className="h1">Plan my evening</h1>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          {nowMin < toMin(settings.end)
            ? `Tonight until ${settings.end}, around tutoring and dinner.`
            : "The evening is over. Here's what tonight looked like."}
        </p>
      </header>

      <section className="card evening-hero rise d1">
        <div className="stack" style={{ gap: 2, flex: 1 }}>
          <span className="eyebrow">Done tonight</span>
          <span className="big-num">
            {doneWork}/{work.length}
          </span>
          <span className="muted s13">
            {work.length === 0
              ? "Nothing to do tonight. Rest!"
              : doneWork === work.length
                ? "All done. Great evening."
                : `${work.filter((b) => !ticks.includes(b.id)).reduce((n, b) => n + b.mins, 0)} min left`}
          </span>
        </div>
        <div className="stack" style={{ gap: 8, alignItems: "flex-end" }}>
          <button className="btn sm" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            <Icon name="clock" size={14} />
            Times
          </button>
          {ai && (
            <button className="btn sm" onClick={() => void askTip()}>
              <Icon name="sparkle" size={14} />
              Tip
            </button>
          )}
        </div>
      </section>

      {editing && (
        <section className="card evening-times rise" aria-label="Evening times">
          {(
            [
              ["start", "Start"],
              ["dinner", "Dinner"],
              ["end", "Stop"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="stack" style={{ gap: 4 }}>
              <span className="s12 muted">{label}</span>
              <input
                className="field"
                type="time"
                value={settings[key]}
                onChange={(e) => e.target.value && setTime(key, e.target.value)}
              />
            </label>
          ))}
        </section>
      )}

      {tip && (
        <section className="card ai rise" aria-live="polite">
          <span className="chip violet">
            <Icon name="sparkle" size={14} />
            Tip
          </span>
          <p style={{ margin: "8px 0 0" }}>{tip}</p>
        </section>
      )}

      <ol className="timeline rise d2" aria-label="Tonight">
        {plan.blocks.map((b) => {
          const k = KIND[b.kind];
          const isWork = WORK.has(b.kind);
          const done = ticks.includes(b.id);
          return (
            <li
              key={b.id}
              className={`tblock kind-${b.kind}${done ? " done" : ""}${current === b ? " now" : ""}`}
            >
              <span className="ttime num">{hhmm(b.start)}</span>
              <span className={`ic tone-${k.tone}`} aria-hidden="true">
                <Icon name={k.icon} size={18} />
              </span>
              <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <button
                  type="button"
                  className="tblock-title"
                  onClick={() => open(b)}
                  disabled={!isWork && b.kind !== "tutor"}
                >
                  {b.title}
                </button>
                <span className="s12 muted">
                  {b.mins} min · {b.detail}
                  {current === b ? " · now" : ""}
                </span>
                {isWork && !done && (
                  <span className="row" style={{ gap: 6, marginTop: 4 }}>
                    <FocusButton title={b.title} label="Start" className="btn sm" />
                  </span>
                )}
              </span>
              {isWork && (
                <input
                  className="cb"
                  type="checkbox"
                  checked={done}
                  onChange={() => toggle(b)}
                  aria-label={`Done: ${b.title}`}
                />
              )}
            </li>
          );
        })}
      </ol>

      {plan.leftOver.length > 0 && (
        <section className="card rise d3">
          <span className="eyebrow">Didn't fit tonight</span>
          <ul className="release-list">
            {plan.leftOver.map((t) => (
              <li key={t.id}>
                {t.title} <span className="muted">({t.mins} min)</span>
              </li>
            ))}
          </ul>
          <p className="s12 muted" style={{ margin: 0 }}>
            Start earlier or stop later under Times, or do these tomorrow.
          </p>
        </section>
      )}
    </main>
  );
}
