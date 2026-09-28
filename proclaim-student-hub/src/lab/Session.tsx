import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import {
  ACCENT_KEYS,
  markAnswer,
  quizOptions,
  shuffle,
  type Item,
  type LabPack,
  type ModeId,
  type Subject,
  type Verdict,
} from "./model.ts";
import { explainItem } from "./scan.ts";
import type { LabSettings } from "./store.ts";

// The practice engine for item-by-item modes (flashcards, quiz, write, speed,
// boss, mock). Every answer becomes a verdict; the Lab applies them to the
// spaced-repetition boxes when the session ends.

export interface Entry {
  pack: LabPack;
  item: Item;
}

export interface Answer {
  label: string;
  verdict: Verdict;
  packId?: string;
  itemId?: string;
}

export interface Outcome {
  mode: ModeId;
  answers: Answer[];
  /** A line for the results screen ("You beat the boss!"). */
  note?: string;
}

type Style = "card" | "quiz" | "write";

const flip = (item: Item): Item => ({ ...item, prompt: item.answer, answer: item.prompt });

// ---------- Small shared pieces ----------

export function SessionHeader({
  title,
  done,
  total,
  onQuit,
  children,
}: {
  title: string;
  done: number;
  total: number;
  onQuit: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="stack rise" style={{ gap: 10 }}>
      <div className="between">
        <button className="link-btn" onClick={onQuit}>
          ‹ Stop
        </button>
        <span className="eyebrow">{title}</span>
        <span className="muted" style={{ fontSize: 13 }}>
          {Math.min(done + 1, total)}/{total}
        </span>
      </div>
      <div className="bar" aria-hidden="true">
        <div style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
      </div>
      {children}
    </header>
  );
}

/** Buttons for letters a phone keyboard hides (Spanish and Czech). */
export function AccentKeys({
  subject,
  input,
  onChange,
}: {
  subject: Subject;
  input: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
}) {
  const keys = ACCENT_KEYS[subject];
  if (!keys) {
    return null;
  }
  return (
    <div className="accent-keys" role="group" aria-label="Accent letters">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          className="pill"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const el = input.current;
            if (!el) {
              return;
            }
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? start;
            onChange(el.value.slice(0, start) + k + el.value.slice(end));
            requestAnimationFrame(() => {
              el.focus();
              el.setSelectionRange(start + k.length, start + k.length);
            });
          }}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

const VERDICT_TEXT: Record<Verdict, string> = {
  correct: "Correct!",
  almost: "Almost!",
  wrong: "Not quite",
};

/** What the student sees after answering: right, almost or wrong, and why. */
export function Feedback({
  verdict,
  answer,
  given,
  note,
  entry,
  prefs,
  onContinue,
}: {
  verdict: Verdict;
  answer: string;
  given: string;
  note?: string;
  entry?: Entry;
  prefs: LabSettings;
  onContinue: (override?: Verdict) => void;
}) {
  const { ai, handleError } = useApp();
  const [more, setMore] = useState<string | "loading" | null>(null);
  const explanation = entry?.item.explanation;

  return (
    <section className={`feedback ${verdict} pop`} aria-live="polite">
      <div className="between">
        <strong style={{ fontSize: 18 }}>{VERDICT_TEXT[verdict]}</strong>
        <Icon name={verdict === "wrong" ? "close" : "check"} size={20} />
      </div>
      {note && <div>{note}</div>}
      {verdict !== "correct" && (
        <div className="stack" style={{ gap: 2 }}>
          {given && (
            <span>
              You: <s>{given}</s>
            </span>
          )}
          <span>
            Answer: <strong>{answer}</strong>
          </span>
        </div>
      )}
      {explanation && verdict !== "correct" && <p style={{ margin: 0 }}>{explanation}</p>}
      {more && more !== "loading" && <p style={{ margin: 0 }}>{more}</p>}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn primary" autoFocus onClick={() => onContinue()}>
          Continue
        </button>
        {verdict !== "correct" && ai && entry && more === null && (
          <button
            className="btn small"
            onClick={async () => {
              setMore("loading");
              try {
                setMore(await explainItem(ai, entry.item, entry.pack, prefs));
              } catch (err) {
                setMore(null);
                handleError(err);
              }
            }}
          >
            <Icon name="sparkle" size={14} />
            Explain more
          </button>
        )}
        {more === "loading" && <Icon name="loader" size={18} className="spin" />}
        {verdict === "wrong" && given && (
          <button className="btn small ghost" onClick={() => onContinue("correct")}>
            I was right
          </button>
        )}
      </div>
    </section>
  );
}

// ---------- One question ----------

function Question({
  entry,
  style,
  reverse,
  feedback,
  prefs,
  onAnswer,
}: {
  entry: Entry;
  style: Style;
  reverse: boolean;
  /** Show right/wrong and the explanation before moving on. */
  feedback: boolean;
  prefs: LabSettings;
  onAnswer: (verdict: Verdict) => void;
}) {
  const backwards = reverse && entry.item.kind === "term";
  const shown = useMemo(() => (backwards ? flip(entry.item) : entry.item), [backwards, entry]);
  const options = useMemo(
    () => quizOptions(shown, backwards ? entry.pack.items.map(flip) : entry.pack.items),
    [shown, backwards, entry],
  );
  // With too few different answers a quiz is a giveaway; rate yourself instead.
  const kind: Style = style === "quiz" && options.length < 3 ? "card" : style;
  const [flipped, setFlipped] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<{ verdict: Verdict; given: string; note: string } | null>(
    null,
  );
  const input = useRef<HTMLInputElement>(null);

  const settle = (verdict: Verdict, given: string, note = "") => {
    if (feedback) {
      setResult({ verdict, given, note });
    } else {
      onAnswer(verdict);
    }
  };

  const prompt = (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <span className="chip">{entry.pack.subject}</span>
        {entry.item.markedWrong && <span className="chip warm">Wrong on your test</span>}
      </div>
      <div className="flashcard-text">{shown.prompt}</div>
    </div>
  );

  if (result) {
    return (
      <div className="stack">
        <div className="card">{prompt}</div>
        <Feedback
          verdict={result.verdict}
          answer={shown.answer}
          given={result.given}
          note={result.note}
          entry={entry}
          prefs={prefs}
          onContinue={(override) => onAnswer(override ?? result.verdict)}
        />
      </div>
    );
  }

  if (kind === "card") {
    return (
      <div className="stack">
        <button
          className={`flashcard${flipped ? " back" : ""}`}
          key={flipped ? "b" : "f"}
          onClick={() => setFlipped(true)}
          aria-label={flipped ? "Answer" : "Tap to see the answer"}
        >
          {flipped ? (
            <div className="stack" style={{ gap: 8 }}>
              <div className="flashcard-text">{shown.answer}</div>
              {entry.item.explanation && (
                <div style={{ opacity: 0.8 }}>{entry.item.explanation}</div>
              )}
            </div>
          ) : (
            prompt
          )}
          <span style={{ fontSize: 13, opacity: 0.7 }}>
            {flipped ? "How did you do?" : "Think of the answer, then tap"}
          </span>
        </button>
        {flipped && (
          <div className="rate-row rise">
            <button className="btn" onClick={() => onAnswer("wrong")}>
              Didn't know
            </button>
            <button className="btn" onClick={() => onAnswer("almost")}>
              Almost
            </button>
            <button className="btn primary" onClick={() => onAnswer("correct")}>
              Knew it
            </button>
          </div>
        )}
      </div>
    );
  }

  if (kind === "quiz") {
    return (
      <div className="stack">
        <div className="card">{prompt}</div>
        <div className="stack" style={{ gap: 8 }}>
          {options.map((o) => (
            <button
              key={o}
              className="game-btn"
              onClick={() => settle(o === shown.answer ? "correct" : "wrong", o)}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (typed.trim()) {
          const m = markAnswer(typed, shown.answer);
          settle(m.verdict, typed.trim(), m.note);
        }
      }}
    >
      <div className="card">{prompt}</div>
      <label htmlFor="lab-answer" className="sr-only">
        Your answer
      </label>
      <input
        id="lab-answer"
        ref={input}
        className="field"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder="Type your answer"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        autoFocus
      />
      <AccentKeys subject={entry.pack.subject} input={input} onChange={setTyped} />
      <div className="row">
        <button className="btn primary" type="submit" disabled={!typed.trim()} style={{ flex: 1 }}>
          Check
        </button>
        <button className="btn ghost" type="button" onClick={() => settle("wrong", "")}>
          I don't know
        </button>
      </div>
    </form>
  );
}

// ---------- Sessions ----------

export function Session(props: {
  mode: "flashcards" | "quiz" | "write" | "speed" | "boss" | "mock";
  entries: Entry[];
  prefs: LabSettings;
  onDone: (outcome: Outcome) => void;
  onQuit: () => void;
}) {
  if (props.mode === "speed") {
    return <Speed {...props} />;
  }
  if (props.mode === "boss") {
    return <Boss {...props} />;
  }
  return <Straight {...props} mode={props.mode} />;
}

const answerFor = (entry: Entry, verdict: Verdict): Answer => ({
  label: entry.item.prompt,
  verdict,
  packId: entry.pack.id,
  itemId: entry.item.id,
});

/** Flashcards, quiz, write and mock test: one question after another. */
function Straight({
  mode,
  entries,
  prefs,
  onDone,
  onQuit,
}: {
  mode: "flashcards" | "quiz" | "write" | "mock";
  entries: Entry[];
  prefs: LabSettings;
  onDone: (outcome: Outcome) => void;
  onQuit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const entry = entries[index];
  const style: Style =
    mode === "flashcards"
      ? "card"
      : mode === "quiz"
        ? "quiz"
        : mode === "write"
          ? "write"
          : index % 2
            ? "quiz"
            : "write";
  const title = { flashcards: "Flashcards", quiz: "Quiz", write: "Write it", mock: "Mock test" }[
    mode
  ];

  const next = (verdict: Verdict) => {
    const all = [...answers, answerFor(entry, verdict)];
    if (index + 1 >= entries.length) {
      onDone({ mode, answers: all });
      return;
    }
    setAnswers(all);
    setIndex(index + 1);
  };

  return (
    <main className="screen">
      <SessionHeader title={title} done={index} total={entries.length} onQuit={onQuit}>
        {mode === "mock" && <p className="sub">Test conditions: answers are marked at the end.</p>}
      </SessionHeader>
      <Question
        key={`${index}-${entry.item.id}`}
        entry={entry}
        style={style}
        // Language terms are asked both ways; typing the foreign word practises spelling.
        reverse={mode === "write" || mode === "mock" ? index % 2 === 1 : index % 3 === 2}
        feedback={mode !== "mock" && mode !== "flashcards"}
        prefs={prefs}
        onAnswer={next}
      />
    </main>
  );
}

const SPEED_SECONDS = 60;

function Speed({
  entries,
  prefs,
  onDone,
  onQuit,
}: {
  entries: Entry[];
  prefs: LabSettings;
  onDone: (outcome: Outcome) => void;
  onQuit: () => void;
}) {
  const order = useMemo(() => shuffle(entries, entries.length + (Date.now() % 1000)), [entries]);
  const [left, setLeft] = useState(SPEED_SECONDS);
  const [count, setCount] = useState(0);
  const [flash, setFlash] = useState<Verdict | null>(null);
  const answers = useRef<Answer[]>([]);
  const finished = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setLeft((s) => s - 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (left <= 0 && !finished.current) {
      finished.current = true;
      const right = answers.current.filter((a) => a.verdict === "correct").length;
      onDone({
        mode: "speed",
        answers: answers.current,
        note: `${right} right in ${SPEED_SECONDS} seconds.`,
      });
    }
  }, [left, onDone]);

  const entry = order[count % order.length];
  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 10 }}>
        <div className="between">
          <button className="link-btn" onClick={onQuit}>
            ‹ Stop
          </button>
          <span className={`chip${left <= 10 ? " warm" : " accent"}`} aria-live="off">
            {Math.max(0, left)}s
          </span>
          <span className="chip good">
            {answers.current.filter((a) => a.verdict === "correct").length} right
            {flash && <span className="xp-float">{flash === "correct" ? "✓" : "✗"}</span>}
          </span>
        </div>
        <div className="bar" aria-hidden="true">
          <div
            style={{
              width: `${(Math.max(0, left) / SPEED_SECONDS) * 100}%`,
              transition: "width 1s linear",
            }}
          />
        </div>
      </header>
      <Question
        key={count}
        entry={entry}
        style="quiz"
        reverse={count % 2 === 1}
        feedback={false}
        prefs={prefs}
        onAnswer={(verdict) => {
          answers.current = [...answers.current, answerFor(entry, verdict)];
          setFlash(verdict);
          setCount((c) => c + 1);
        }}
      />
    </main>
  );
}

const LIVES = 3;
const HIT = 10;

function Boss({
  entries,
  prefs,
  onDone,
  onQuit,
}: {
  entries: Entry[];
  prefs: LabSettings;
  onDone: (outcome: Outcome) => void;
  onQuit: () => void;
}) {
  const maxHp = entries.length * HIT;
  const [index, setIndex] = useState(0);
  const [hp, setHp] = useState(maxHp);
  const [lives, setLives] = useState(LIVES);
  const [hurt, setHurt] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const entry = entries[index];

  const next = (verdict: Verdict) => {
    const all = [...answers, answerFor(entry, verdict)];
    const nextHp = hp - (verdict === "correct" ? HIT : verdict === "almost" ? HIT / 2 : 0);
    const nextLives = lives - (verdict === "wrong" ? 1 : 0);
    if (nextHp <= 0 || nextLives <= 0 || index + 1 >= entries.length) {
      onDone({
        mode: "boss",
        answers: all,
        note:
          nextHp <= 0
            ? "You beat the boss!"
            : nextLives <= 0
              ? "The boss won this time. Go again!"
              : "The boss escaped with a little health left.",
      });
      return;
    }
    setAnswers(all);
    setHp(nextHp);
    setLives(nextLives);
    setHurt((h) => h + (verdict === "wrong" ? 0 : 1));
    setIndex(index + 1);
  };

  return (
    <main className="screen">
      <SessionHeader title="Boss battle" done={index} total={entries.length} onQuit={onQuit}>
        <div className="card-dark stack" style={{ gap: 8 }}>
          <div className="between">
            <span key={hurt} className={`boss${hurt ? " shake-a" : ""}`} aria-hidden="true">
              👾
            </span>
            <span aria-label={`${lives} lives left`}>
              {"♥".repeat(lives)}
              <span style={{ opacity: 0.3 }}>{"♥".repeat(LIVES - lives)}</span>
            </span>
          </div>
          <div
            className="bar boss-bar"
            aria-label={`Boss health ${Math.round((hp / maxHp) * 100)}%`}
          >
            <div style={{ width: `${(hp / maxHp) * 100}%` }} />
          </div>
        </div>
      </SessionHeader>
      <Question
        key={index}
        entry={entry}
        style={index % 2 ? "write" : "quiz"}
        reverse={index % 4 === 3}
        feedback
        prefs={prefs}
        onAnswer={next}
      />
    </main>
  );
}
