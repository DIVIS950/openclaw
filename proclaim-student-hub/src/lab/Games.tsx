import { useMemo, useRef, useState } from "react";
import { markAnswer, matchable, shuffle, type LabPack, type Verdict } from "./model.ts";
import { AccentKeys, SessionHeader, type Answer, type Outcome } from "./Session.tsx";

// The games that work on a whole set at once rather than one item at a time.

interface GameProps {
  pack: LabPack;
  onDone: (outcome: Outcome) => void;
  onQuit: () => void;
}

const MATCH_SIZE = 6;

export function Match({ pack, onDone, onQuit }: GameProps) {
  const [round] = useState(() => Date.now() % 997);
  const items = useMemo(
    () => shuffle(matchable(pack.items), round).slice(0, MATCH_SIZE),
    [pack, round],
  );
  const lefts = useMemo(() => shuffle(items, round + 1), [items, round]);
  const rights = useMemo(() => shuffle(items, round + 2), [items, round]);
  const [picked, setPicked] = useState<string | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [missed, setMissed] = useState<string[]>([]);
  const [shake, setShake] = useState<{ id: string; n: number } | null>(null);

  const choose = (rightId: string) => {
    if (!picked) {
      return;
    }
    if (rightId === picked) {
      const done = [...matched, picked];
      setMatched(done);
      setPicked(null);
      if (done.length === items.length) {
        onDone({
          mode: "match",
          answers: items.map((i) => ({
            label: i.prompt,
            verdict: missed.includes(i.id) ? "wrong" : "correct",
            packId: pack.id,
            itemId: i.id,
          })),
        });
      }
      return;
    }
    setMissed((m) => (m.includes(picked) ? m : [...m, picked]));
    setShake({ id: rightId, n: (shake?.n ?? 0) + 1 });
  };

  return (
    <main className="screen">
      <SessionHeader title="Match" done={matched.length} total={items.length} onQuit={onQuit}>
        <p className="sub">Tap a term, then its meaning.</p>
      </SessionHeader>
      <div className="match-grid">
        <div className="stack" style={{ gap: 8 }}>
          {lefts.map((i) => (
            <button
              key={i.id}
              className={`game-btn${matched.includes(i.id) ? " matched" : picked === i.id ? " selected" : ""}`}
              disabled={matched.includes(i.id)}
              onClick={() => setPicked(i.id)}
            >
              {i.prompt}
            </button>
          ))}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {rights.map((i) => (
            <button
              key={shake?.id === i.id ? `${i.id}-${shake.n}` : i.id}
              className={`game-btn${matched.includes(i.id) ? " matched" : ""}${
                shake?.id === i.id ? (shake.n % 2 ? " wrong shake-a" : " wrong shake-b") : ""
              }`}
              disabled={matched.includes(i.id)}
              onClick={() => choose(i.id)}
            >
              {i.answer}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

export function GapFill({ pack, onDone, onQuit }: GameProps) {
  const gaps = pack.gaps;
  const bank = useMemo(() => shuffle([...new Set(gaps.map((g) => g.answer))], gaps.length), [gaps]);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<{ verdict: Verdict; note: string } | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const gap = gaps[index];

  const next = () => {
    if (!result) {
      return;
    }
    const all = [...answers, { label: gap.answer, verdict: result.verdict }];
    if (index + 1 >= gaps.length) {
      onDone({ mode: "gap", answers: all });
      return;
    }
    setAnswers(all);
    setIndex(index + 1);
    setTyped("");
    setResult(null);
  };

  return (
    <main className="screen">
      <SessionHeader title="Gap-fill" done={index} total={gaps.length} onQuit={onQuit} />
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (result) {
            next();
          } else if (typed.trim()) {
            setResult(markAnswer(typed, gap.answer));
          }
        }}
      >
        <div className="card flashcard-text" style={{ fontSize: 20 }}>
          {gap.before}{" "}
          <span className={`gap-slot${result ? ` ${result.verdict}` : ""}`}>
            {result ? gap.answer : typed || "_____"}
          </span>{" "}
          {gap.after}
        </div>
        {result ? (
          <div className={`feedback ${result.verdict} pop`} aria-live="polite">
            <strong>
              {result.verdict === "correct"
                ? "Correct!"
                : result.verdict === "almost"
                  ? "Almost!"
                  : "Not quite"}
            </strong>
            {result.note && <span>{result.note}</span>}
            {result.verdict !== "correct" && (
              <span>
                Answer: <strong>{gap.answer}</strong>
              </span>
            )}
            <button className="btn primary" type="submit" autoFocus>
              Continue
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="gap-answer" className="sr-only">
              Missing word
            </label>
            <input
              id="gap-answer"
              ref={input}
              className="field"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Missing word"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
            />
            <AccentKeys subject={pack.subject} input={input} onChange={setTyped} />
            {bank.length > 1 && (
              <div className="pills" role="group" aria-label="Word bank">
                {bank.map((w) => (
                  <button key={w} type="button" className="pill" onClick={() => setTyped(w)}>
                    {w}
                  </button>
                ))}
              </div>
            )}
            <button className="btn primary" type="submit" disabled={!typed.trim()}>
              Check
            </button>
          </>
        )}
      </form>
    </main>
  );
}

export function OrderSteps({ pack, onDone, onQuit }: GameProps) {
  const steps = pack.steps;
  const pool = useMemo(
    () =>
      shuffle(
        steps.map((text, at) => ({ text, at })),
        steps.length + 3,
      ),
    [steps],
  );
  const [placed, setPlaced] = useState(0);
  const [missed, setMissed] = useState<number[]>([]);
  const [shake, setShake] = useState<{ at: number; n: number } | null>(null);

  const tap = (at: number) => {
    if (at === placed) {
      const done = placed + 1;
      setPlaced(done);
      if (done === steps.length) {
        onDone({
          mode: "order",
          answers: steps.map((text, i) => ({
            label: text,
            verdict: missed.includes(i) ? "wrong" : "correct",
          })),
        });
      }
      return;
    }
    // The one that should have come next is the step the student didn't know.
    setMissed((m) => (m.includes(placed) ? m : [...m, placed]));
    setShake({ at, n: (shake?.n ?? 0) + 1 });
  };

  return (
    <main className="screen">
      <SessionHeader title="Order the steps" done={placed} total={steps.length} onQuit={onQuit}>
        <p className="sub">Tap the steps in the right order, first to last.</p>
      </SessionHeader>
      {placed > 0 && (
        <ol className="stack order-done" style={{ gap: 6 }}>
          {steps.slice(0, placed).map((s, i) => (
            <li key={i} className="game-btn right" style={{ minHeight: 0 }}>
              {s}
            </li>
          ))}
        </ol>
      )}
      <div className="stack" style={{ gap: 8 }}>
        {pool
          .filter((p) => p.at >= placed)
          .map((p) => (
            <button
              key={shake?.at === p.at ? `${p.at}-${shake.n}` : p.at}
              className={`game-btn${shake?.at === p.at ? (shake.n % 2 ? " wrong shake-a" : " wrong shake-b") : ""}`}
              onClick={() => tap(p.at)}
            >
              {p.text}
            </button>
          ))}
      </div>
    </main>
  );
}

export function LabelDiagram({ pack, onDone, onQuit }: GameProps) {
  const labels = pack.labels;
  const names = useMemo(
    () =>
      shuffle(
        labels.map((l, i) => ({ text: l.text, i })),
        5,
      ),
    [labels],
  );
  const [pin, setPin] = useState<number | null>(null);
  const [done, setDone] = useState<number[]>([]);
  const [missed, setMissed] = useState<number[]>([]);
  const [shake, setShake] = useState<{ i: number; n: number } | null>(null);

  const choose = (i: number) => {
    if (pin === null) {
      return;
    }
    if (i === pin) {
      const all = [...done, pin];
      setDone(all);
      setPin(null);
      if (all.length === labels.length) {
        onDone({
          mode: "label",
          answers: labels.map((l, j) => ({
            label: l.text,
            verdict: missed.includes(j) ? "wrong" : "correct",
          })),
        });
      }
      return;
    }
    setMissed((m) => (m.includes(pin) ? m : [...m, pin]));
    setShake({ i, n: (shake?.n ?? 0) + 1 });
  };

  return (
    <main className="screen">
      <SessionHeader
        title="Label the diagram"
        done={done.length}
        total={labels.length}
        onQuit={onQuit}
      >
        <p className="sub">Tap a numbered pin, then the label that goes there.</p>
      </SessionHeader>
      <div className="diagram">
        <img src={pack.photo} alt={`Diagram: ${pack.topic}`} />
        {labels.map((l, i) => (
          <button
            key={i}
            className={`pin${pin === i ? " selected" : ""}${done.includes(i) ? " placed" : ""}`}
            style={{ left: `${l.x}%`, top: `${l.y}%` }}
            disabled={done.includes(i)}
            aria-label={done.includes(i) ? l.text : `Pin ${i + 1}`}
            onClick={() => setPin(i)}
          >
            {done.includes(i) ? l.text : i + 1}
          </button>
        ))}
      </div>
      <div className="pills" role="group" aria-label="Labels">
        {names
          .filter((n) => !done.includes(n.i))
          .map((n) => (
            <button
              key={shake?.i === n.i ? `${n.i}-${shake.n}` : n.i}
              className={`pill${shake?.i === n.i ? (shake.n % 2 ? " shake-a" : " shake-b") : ""}`}
              disabled={pin === null}
              onClick={() => choose(n.i)}
            >
              {n.text}
            </button>
          ))}
      </div>
    </main>
  );
}
