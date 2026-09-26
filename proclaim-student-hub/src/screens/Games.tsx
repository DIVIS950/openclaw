import { useEffect, useMemo, useRef, useState } from "react";
import { SAMPLE_PACK, type RevisionPack } from "../../shared/pack.ts";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { packs, progress } from "../lib/store.ts";

type Game = "match" | "speed" | "gap";

export function Games() {
  const { go } = useApp();
  const pack = packs.current()?.pack ?? SAMPLE_PACK;
  const [game, setGame] = useState<Game>("match");
  const [stats, setStats] = useState(progress.get);
  const [gain, setGain] = useState<{ n: number; key: number } | null>(null);

  const award = (n: number) => {
    setStats(progress.add(n));
    setGain({ n, key: Date.now() });
  };

  return (
    <main className="screen" style={{ gap: 14 }}>
      <header className="stack rise" style={{ gap: 10 }}>
        <div className="between">
          <button className="link-btn" onClick={() => go("revise")}>
            ‹ Revision
          </button>
          <div className="row">
            <span className="chip warm" style={{ borderRadius: 16, padding: "6px 10px" }}>
              <Icon name="flame" size={16} className="wiggle" />
              {stats.streak} {stats.streak === 1 ? "day" : "days"}
            </span>
            <span className="chip accent" style={{ position: "relative" }}>
              <Icon name="star" size={16} />
              {stats.xp} XP
              {gain && (
                <span key={gain.key} className="xp-float">
                  +{gain.n}
                </span>
              )}
            </span>
          </div>
        </div>
        <div>
          <h1 className="h1" style={{ fontSize: 28 }}>
            Learning games
          </h1>
          <p className="sub" style={{ fontSize: 13 }}>
            Made from your {pack.topic} notes
          </p>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Choose a game"
        style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}
      >
        {(
          [
            ["match", "Match up"],
            ["speed", "Speed round"],
            ["gap", "Fill the gap"],
          ] as [Game, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={game === id}
            className={`btn${game === id ? " dark" : ""}`}
            onClick={() => setGame(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {game === "match" && <MatchUp pack={pack} award={award} />}
      {game === "speed" && <SpeedRound pack={pack} award={award} />}
      {game === "gap" && <FillGap pack={pack} award={award} />}
    </main>
  );
}

/** Stable shuffle so the order doesn't jump around between renders. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function MatchUp({ pack, award }: { pack: RevisionPack; award: (n: number) => void }) {
  const [round, setRound] = useState(1);
  const [sel, setSel] = useState<number | null>(null);
  const [done, setDone] = useState<number[]>([]);
  const [wrong, setWrong] = useState<{ j: number; n: number } | null>(null);
  const pairs = pack.match;
  const meanings = useMemo(
    () =>
      shuffled(
        pairs.map((p, i) => ({ text: p.meaning, term: i })),
        round * 7 + pairs.length,
      ),
    [pairs, round],
  );

  if (pairs.length < 2) {
    return <div className="card empty">Not enough key terms in these notes for Match up.</div>;
  }
  const allDone = done.length === pairs.length;

  return (
    <section className="stack rise">
      <div className="between muted">
        <span>Tap a word, then its meaning</span>
        <strong style={{ color: "var(--ink)" }}>
          {done.length}/{pairs.length}
        </strong>
      </div>
      <div className="bar">
        <div style={{ width: `${(done.length / pairs.length) * 100}%` }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        <div className="stack" style={{ gap: 8 }}>
          {pairs.map((p, i) => (
            <button
              key={i}
              className={`game-btn${done.includes(i) ? " matched" : sel === i ? " selected" : ""}`}
              disabled={done.includes(i)}
              onClick={() => {
                setSel(i);
                setWrong(null);
              }}
            >
              {p.term}
            </button>
          ))}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {meanings.map((m, j) => {
            const isDone = done.includes(m.term);
            const isWrong = wrong?.j === j;
            return (
              <button
                key={j}
                className={`game-btn${isDone ? " matched" : isWrong ? ` wrong ${wrong.n % 2 ? "shake-a" : "shake-b"}` : ""}`}
                style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}
                disabled={isDone}
                onClick={() => {
                  if (sel === null) {
                    return;
                  }
                  if (m.term === sel) {
                    setDone([...done, sel]);
                    setSel(null);
                    setWrong(null);
                    award(10);
                  } else {
                    setWrong({ j, n: (wrong?.n ?? 0) + 1 });
                  }
                }}
              >
                {m.text}
              </button>
            );
          })}
        </div>
      </div>
      {allDone && (
        <div
          className="row pop"
          style={{
            background: "var(--accent)",
            color: "#fff",
            borderRadius: 16,
            padding: "14px 16px",
            gap: 12,
          }}
        >
          <Icon name="star" size={28} className="wiggle" />
          <div style={{ flex: 1, fontWeight: 600 }}>All matched! +{pairs.length * 10} XP</div>
          <button
            className="btn small"
            onClick={() => {
              setDone([]);
              setSel(null);
              setRound(round + 1);
            }}
          >
            Again
          </button>
        </div>
      )}
    </section>
  );
}

const SPEED_SECONDS = 8;

function SpeedRound({ pack, award }: { pack: RevisionPack; award: (n: number) => void }) {
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [last, setLast] = useState<"right" | "wrong" | "late" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const items = pack.trueFalse;
  const item = items[i];

  const advance = () => {
    window.setTimeout(() => {
      setLast(null);
      setI((n) => n + 1);
    }, 1300);
  };

  // Out of time counts as a miss.
  useEffect(() => {
    if (!item || last !== null) {
      return;
    }
    timer.current = window.setTimeout(() => {
      setLast("late");
      advance();
    }, SPEED_SECONDS * 1000);
    return () => window.clearTimeout(timer.current);
  }, [i, item, last]);

  if (items.length === 0) {
    return <div className="card empty">No true/false questions in these notes.</div>;
  }
  if (!item) {
    return (
      <section
        className="card-dark stack pop"
        style={{ alignItems: "center", textAlign: "center" }}
      >
        <div style={{ color: "#c9c4b8", fontSize: 13, fontWeight: 600 }}>Speed round done</div>
        <div style={{ fontFamily: "var(--serif)", fontSize: 44, fontWeight: 600 }}>
          {score}/{items.length}
        </div>
        <button
          className="btn"
          onClick={() => {
            setI(0);
            setScore(0);
          }}
        >
          Play again
        </button>
      </section>
    );
  }

  const answer = (v: boolean) => {
    if (last !== null) {
      return;
    }
    window.clearTimeout(timer.current);
    if (v === item.answer) {
      setLast("right");
      setScore(score + 1);
      award(5);
    } else {
      setLast("wrong");
    }
    advance();
  };

  return (
    <section key={i} className="card stack rise" style={{ gap: 16, borderRadius: 20, padding: 20 }}>
      <div className="between muted">
        <span>True or false?</span>
        <strong style={{ color: "var(--ink)" }}>
          {i + 1} of {items.length}
        </strong>
      </div>
      <div className="bar">
        <div
          style={{
            animation: last === null ? `drain ${SPEED_SECONDS}s linear both` : "none",
            width: last === null ? undefined : 0,
          }}
        />
      </div>
      <p
        style={{
          margin: 0,
          minHeight: 90,
          fontFamily: "var(--serif)",
          fontSize: 23,
          lineHeight: 1.3,
        }}
      >
        {item.statement}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        <button className="btn big primary" onClick={() => answer(true)} disabled={last !== null}>
          True
        </button>
        <button
          className="btn big"
          style={{ borderColor: "var(--ink)" }}
          onClick={() => answer(false)}
          disabled={last !== null}
        >
          False
        </button>
      </div>
      {last && (
        <div
          className="pop"
          style={{
            fontSize: 14,
            lineHeight: 1.45,
            background: "var(--chip)",
            borderRadius: 12,
            padding: 12,
          }}
        >
          {last === "right"
            ? "Correct! +5 XP. "
            : last === "late"
              ? "Out of time! "
              : "Not quite. "}
          It's {item.answer ? "true" : "false"}: {item.why}
        </div>
      )}
    </section>
  );
}

function FillGap({ pack, award }: { pack: RevisionPack; award: (n: number) => void }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const g = pack.gaps[i];
  const options = useMemo(() => (g ? shuffled(g.options, i + 3) : []), [g, i]);

  if (pack.gaps.length === 0) {
    return <div className="card empty">No fill-the-gap sentences in these notes.</div>;
  }
  if (!g) {
    return (
      <section
        className="card-dark stack pop"
        style={{ alignItems: "center", textAlign: "center" }}
      >
        <div style={{ color: "#c9c4b8", fontSize: 13, fontWeight: 600 }}>All gaps filled</div>
        <div style={{ fontFamily: "var(--serif)", fontSize: 44, fontWeight: 600 }}>
          {score}/{pack.gaps.length}
        </div>
        <button
          className="btn"
          onClick={() => {
            setI(0);
            setScore(0);
          }}
        >
          Play again
        </button>
      </section>
    );
  }

  const isRight = (o: string) => o.toLowerCase() === g.answer.toLowerCase();
  const blankStyle: React.CSSProperties =
    picked === null
      ? { borderBottom: "2px dashed var(--muted)" }
      : isRight(picked)
        ? { background: "var(--accent-soft)", color: "var(--accent-ink)" }
        : { background: "var(--warm-soft)", color: "var(--warm)", textDecoration: "line-through" };

  return (
    <section key={i} className="card stack rise" style={{ gap: 16, borderRadius: 20, padding: 20 }}>
      <div className="muted">
        Sentence {i + 1} of {pack.gaps.length}
      </div>
      <p style={{ margin: 0, fontFamily: "var(--serif)", fontSize: 23, lineHeight: 1.4 }}>
        {g.before}{" "}
        <span
          style={{
            display: "inline-block",
            minWidth: 90,
            padding: "0 6px",
            borderRadius: 6,
            ...blankStyle,
          }}
        >
          {picked ?? " "}
        </span>
        {g.after}
      </p>
      <div className="stack" style={{ gap: 8 }}>
        {options.map((o) => (
          <button
            key={o}
            className={`game-btn${picked === null ? "" : isRight(o) ? " right" : picked === o ? " wrong shake-a" : ""}`}
            style={{ minHeight: 48 }}
            onClick={() => {
              if (picked !== null) {
                return;
              }
              setPicked(o);
              if (isRight(o)) {
                setScore(score + 1);
                award(5);
              }
            }}
          >
            {o}
          </button>
        ))}
      </div>
      {picked !== null && (
        <button
          className="btn big dark pop"
          onClick={() => {
            setPicked(null);
            setI(i + 1);
          }}
        >
          Next ›
        </button>
      )}
    </section>
  );
}
