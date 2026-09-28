import { useEffect, useState } from "react";
import { useConfetti } from "../components/Confetti.tsx";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { subjectLook } from "../lib/subjects.ts";
import { canSpeak, speak } from "../lib/voice.ts";
import {
  dayString,
  isDue,
  isWeak,
  mastery,
  MODES,
  modeBlocked,
  scorePercent,
  sessionPercent,
  TOP_BOX,
  type LabPack,
  type ModeId,
} from "./model.ts";
import { moreItems } from "./scan.ts";
import type { Outcome } from "./Session.tsx";
import type { LabSettings } from "./store.ts";

const MODE_ICONS: Record<ModeId, string> = {
  learn: "📖",
  flashcards: "🃏",
  quiz: "❓",
  write: "✍️",
  match: "🔗",
  gap: "🧩",
  order: "🔢",
  label: "📍",
  boss: "👾",
  speed: "⚡",
  mock: "📝",
};

/** One dot per item, filled by how far up the boxes it is. */
export function MasteryDots({ pack }: { pack: LabPack }) {
  return (
    <div className="dots" aria-label={`${mastery(pack.items)}% mastered`}>
      {pack.items.map((i) => (
        <span
          key={i.id}
          className={`dot${i.markedWrong && i.box < 2 ? " flagged" : ""}`}
          style={{ opacity: 0.25 + (0.75 * i.box) / TOP_BOX }}
          title={`${i.prompt}: level ${i.box}/${TOP_BOX}`}
        />
      ))}
    </div>
  );
}

export function PackHome({
  pack,
  prefs,
  online,
  onBack,
  onPlay,
  onUpdate,
  onDelete,
}: {
  pack: LabPack;
  prefs: LabSettings;
  online: boolean;
  onBack: () => void;
  onPlay: (mode: ModeId) => void;
  onUpdate: (pack: LabPack) => void;
  onDelete: () => void;
}) {
  const { ai, handleError, toast } = useApp();
  const [adding, setAdding] = useState(false);
  const today = dayString(new Date());
  const due = pack.items.filter((i) => isDue(i, today)).length;
  const weak = pack.items.filter(isWeak).length;
  useAiContext(
    `Revision pack: ${pack.subject}, "${pack.topic}". ${pack.insight ? `Big fix: ${pack.insight}. ` : ""}Items: ` +
      pack.items.map((i) => `${i.prompt} = ${i.answer}${isWeak(i) ? " (weak)" : ""}`).join("; "),
  );

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 4 }}>
        <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onBack}>
          ‹ Back
        </button>
        <span className="eyebrow">
          {subjectLook(pack.subject).emoji} {pack.subject}
        </span>
        <h1 className="h1">{pack.topic}</h1>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <span className="chip accent">{mastery(pack.items)}% mastered</span>
          <span className="chip">{pack.items.length} items</span>
          {due > 0 && <span className="chip good">{due} due today</span>}
          {weak > 0 && <span className="chip warm">{weak} weak</span>}
          {pack.testScore && <span className="chip">Real test: {pack.testScore}</span>}
        </div>
      </header>

      <MasteryDots pack={pack} />

      {pack.insight && (
        <section className="ai-card rise">
          <h3>
            <Icon name="wand" size={16} />
            The big fix
          </h3>
          <p style={{ margin: 0 }}>{pack.insight}</p>
        </section>
      )}

      <section className="mode-grid" aria-label="Ways to practise">
        {MODES.map((m, i) => {
          const blocked = modeBlocked(m.id, pack);
          return (
            <button
              key={m.id}
              className="mode-tile rise"
              style={{ animationDelay: `${i * 0.03}s` }}
              disabled={Boolean(blocked)}
              onClick={() => onPlay(m.id)}
            >
              <span className="mode-icon" aria-hidden="true">
                {MODE_ICONS[m.id]}
              </span>
              <strong>{m.title}</strong>
              <span className="muted">{blocked ?? m.blurb}</span>
            </button>
          );
        })}
      </section>

      {ai && online && (
        <button
          className="btn block"
          disabled={adding}
          onClick={async () => {
            setAdding(true);
            try {
              const extra = await moreItems(ai, pack, prefs, today);
              onUpdate({ ...pack, items: [...pack.items, ...extra] });
              toast(extra.length ? `Added ${extra.length} new items.` : "No new items found.");
            } catch (err) {
              handleError(err);
            } finally {
              setAdding(false);
            }
          }}
        >
          <Icon
            name={adding ? "loader" : "sparkle"}
            size={16}
            className={adding ? "spin" : undefined}
          />
          {adding ? "Adding…" : "Add more items with AI"}
        </button>
      )}
      <button
        className="btn ghost"
        onClick={() => {
          if (window.confirm(`Delete "${pack.topic}"?`)) {
            onDelete();
          }
        }}
      >
        Delete pack
      </button>
    </main>
  );
}

/** Everything in the pack on one page, to read before practising. */
export function LearnList({ pack, onBack }: { pack: LabPack; onBack: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 4 }}>
        <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onBack}>
          ‹ {pack.topic}
        </button>
        <h1 className="h1">Learn list</h1>
        <p className="sub">Tap an item to see why. Items from your test come first.</p>
      </header>
      <div className="card list">
        {pack.items
          .toSorted((a, b) => Number(b.markedWrong) - Number(a.markedWrong))
          .map((i) => (
            <div key={i.id} className="stack" style={{ gap: 4, padding: "10px 0" }}>
              <button className="review-text" onClick={() => setOpen(open === i.id ? null : i.id)}>
                <strong>{i.prompt}</strong>
                <span>{i.answer}</span>
              </button>
              {open === i.id && (
                <div className="stack rise" style={{ gap: 6 }}>
                  {i.studentAnswer && (
                    <span className="muted">
                      On your test you wrote: <s>{i.studentAnswer}</s>
                    </span>
                  )}
                  {i.explanation && <span>{i.explanation}</span>}
                  {canSpeak() && (
                    <button
                      className="btn small"
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => speak(`${i.prompt}. ${i.answer}`)}
                    >
                      <Icon name="speaker" size={14} />
                      Read aloud
                    </button>
                  )}
                </div>
              )}
              <span className="row" style={{ gap: 6 }}>
                {i.markedWrong && <span className="chip warm">Wrong on test</span>}
                {i.origin === "ai" && <span className="chip accent">AI added</span>}
                {isWeak(i) && <span className="chip warm">Weak</span>}
              </span>
            </div>
          ))}
      </div>
      {pack.steps.length > 0 && (
        <div className="card stack">
          <h2 className="h2">In order</h2>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {pack.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      )}
    </main>
  );
}

export function Results({
  outcome,
  pack,
  xp,
  onAgain,
  onMissed,
  onBack,
}: {
  outcome: Outcome;
  pack: LabPack | null;
  xp: number;
  onAgain: () => void;
  onMissed: (() => void) | null;
  onBack: () => void;
}) {
  const percent = sessionPercent(outcome.answers.map((a) => a.verdict));
  const real = pack ? scorePercent(pack.testScore) : null;
  const missed = [
    ...new Set(outcome.answers.filter((a) => a.verdict !== "correct").map((a) => a.label)),
  ];
  const title = MODES.find((m) => m.id === outcome.mode)?.title ?? "Practice";
  const [confetti, celebrate] = useConfetti();
  useEffect(() => {
    if (percent >= 80) {
      celebrate();
    }
  }, [percent, celebrate]);
  useAiContext(
    `Results of ${title}${pack ? ` on "${pack.topic}"` : ""}: ${percent}%. Missed: ${missed.join("; ") || "nothing"}.`,
  );

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 4, textAlign: "center", alignItems: "center" }}>
        {confetti}
        <span className="eyebrow">{title}</span>
        <div className="big-score pop">{percent}%</div>
        <p className="sub">
          {outcome.note ??
            (percent >= 90
              ? "Brilliant!"
              : percent >= 70
                ? "Good work!"
                : percent >= 40
                  ? "Getting there."
                  : "Keep going, it sticks with practice.")}
        </p>
        <span className="chip accent">
          <Icon name="star" size={14} />+{xp} XP
        </span>
      </header>

      {real !== null && outcome.answers.length > 0 && (
        <div className="card between rise">
          <div className="stack" style={{ gap: 2 }}>
            <span className="muted">Real test</span>
            <strong style={{ fontSize: 22 }}>{real}%</strong>
          </div>
          <span style={{ fontSize: 22 }} aria-hidden="true">
            →
          </span>
          <div className="stack" style={{ gap: 2, textAlign: "right" }}>
            <span className="muted">Now</span>
            <strong
              style={{ fontSize: 22, color: percent >= real ? "var(--good)" : "var(--warm)" }}
            >
              {percent}% ({percent >= real ? "+" : ""}
              {percent - real})
            </strong>
          </div>
        </div>
      )}

      {missed.length > 0 && (
        <div className="card stack rise">
          <h2 className="h2">To work on</h2>
          <div className="pills" style={{ flexWrap: "wrap" }}>
            {missed.map((m) => (
              <span key={m} className="chip warm">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      <button className="btn big primary" onClick={onAgain}>
        Go again
      </button>
      {onMissed && missed.length > 0 && (
        <button className="btn big" onClick={onMissed}>
          Practise what I missed
        </button>
      )}
      <button className="btn ghost" onClick={onBack}>
        Done
      </button>
    </main>
  );
}
