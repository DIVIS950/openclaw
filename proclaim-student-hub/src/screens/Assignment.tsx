import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { writingFeedback, type Feedback } from "../lib/aiFeatures.ts";
import { dueLabel } from "../lib/format.ts";
import type { HandInResult, Homework } from "../lib/types.ts";

type SaveState = "loading" | "saved" | "saving" | "error";

const SAVE_DELAY_MS = 1200;

export function Assignment({ hw }: { hw: Homework }) {
  const { data, go, ai, handleError, toast } = useApp();
  const [text, setText] = useState("");
  const [state, setState] = useState<SaveState>("loading");
  const [link, setLink] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const fileId = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  // Saves run one at a time so the first save's new file id is used by the next.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef("");

  useEffect(() => {
    data.loadDraft(hw).then(
      (draft) => {
        fileId.current = draft.fileId;
        latest.current = draft.text;
        setText(draft.text);
        setLink(draft.link);
        setState("saved");
      },
      (err: unknown) => {
        setState("error");
        handleError(err);
      },
    );
    return () => window.clearTimeout(timer.current);
  }, [data, hw, handleError]);

  const save = () => {
    saving.current = saving.current.then(async () => {
      const snapshot = latest.current;
      try {
        const draft = await data.saveDraft(hw, snapshot, fileId.current);
        fileId.current = draft.fileId;
        setLink(draft.link);
        if (latest.current === snapshot) {
          setState("saved");
        }
      } catch (err) {
        setState("error");
        handleError(err);
      }
    });
    return saving.current;
  };

  const onChange = (value: string) => {
    setText(value);
    latest.current = value;
    setState("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, SAVE_DELAY_MS);
  };

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const [feedback, setFeedback] = useState<Feedback | "loading" | null>(null);
  useAiContext(
    `Working on "${hw.title}" (${hw.course}). Task: ${hw.description}. Student's work so far: ${text.slice(0, 3000)}`,
  );

  const getFeedback = async () => {
    if (!ai) {
      toast("The AI needs you signed in.");
      return;
    }
    setFeedback("loading");
    try {
      setFeedback(await writingFeedback(ai, hw, text));
    } catch (err) {
      setFeedback(null);
      handleError(err);
    }
  };

  return (
    <main className="screen" style={{ gap: 14, position: "static" }}>
      <div className="between rise">
        <button className="link-btn" onClick={() => go("homework")}>
          ‹ Homework
        </button>
        <SaveChip state={state} savedLabel={data.labels.saved} />
      </div>

      <header className="stack rise" style={{ gap: 6, animationDelay: "0.05s" }}>
        <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
          {hw.course} · {hw.source === "Classroom" ? "Google Classroom" : hw.source}
        </div>
        <h1 className="h1" style={{ fontSize: 26 }}>
          {hw.title}
        </h1>
        <div className="row">
          <span className="chip">{dueLabel(hw.due)}</span>
          <a
            href={hw.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            Open in Classroom
          </a>
        </div>
      </header>

      {hw.description && (
        <section className="card stack rise" style={{ gap: 6, animationDelay: "0.1s" }}>
          <h2 className="muted" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
            Instructions from your teacher
          </h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {hw.description}
          </p>
        </section>
      )}

      <section className="card stack rise" style={{ animationDelay: "0.15s" }}>
        <div className="row" style={{ gap: 10 }}>
          <span
            className="tile-icon"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "var(--accent-soft)",
              color: "var(--accent-ink)",
            }}
          >
            <Icon name="doc" size={20} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Your work</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {data.labels.workNote}
            </div>
          </div>
          {link && (
            <a className="btn small" href={link} target="_blank" rel="noopener noreferrer">
              Open Doc
            </a>
          )}
        </div>
        <label htmlFor="work" className="sr-only">
          Your work
        </label>
        <textarea
          id="work"
          className="field"
          rows={9}
          value={text}
          disabled={state === "loading"}
          placeholder={
            state === "loading" ? "Loading your work…" : "Start typing. It saves as you go."
          }
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (state === "saving") {
              window.clearTimeout(timer.current);
              void save();
            }
          }}
        />
        <div className="muted" style={{ fontSize: 12 }}>
          {words} words
        </div>
      </section>

      {feedback && feedback !== "loading" && (
        <section className="ai-card pop" aria-label="Writing coach feedback">
          <div className="between">
            <h3>
              <Icon name="sparkle" size={16} />
              Writing coach
            </h3>
            <button
              className="link-btn"
              style={{ minHeight: 32 }}
              onClick={() => setFeedback(null)}
            >
              Hide
            </button>
          </div>
          {feedback.good.length > 0 && (
            <div>
              <strong style={{ fontSize: 13, color: "var(--good)" }}>What works</strong>
              <ul className="ai-list">
                {feedback.good.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          {feedback.improve.length > 0 && (
            <div>
              <strong style={{ fontSize: 13, color: "var(--warm)" }}>To make it better</strong>
              <ul className="ai-list">
                {feedback.improve.map((f, i) => (
                  <li key={i}>
                    <strong>{f.point}</strong>
                    {f.hint ? ` Hint: ${f.hint}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {feedback.spelling.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <strong style={{ fontSize: 13 }}>Spelling and grammar</strong>
              {feedback.spelling.map((s, i) => (
                <div key={i} className="between">
                  <span>
                    <s style={{ color: "var(--warm)" }}>{s.wrong}</s> → <strong>{s.right}</strong>
                  </span>
                  {text.includes(s.wrong) && (
                    <button
                      className="btn small"
                      onClick={() => {
                        onChange(text.replace(s.wrong, s.right));
                        setFeedback({
                          ...feedback,
                          spelling: feedback.spelling.filter((x) => x !== s),
                        });
                      }}
                    >
                      Fix
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {feedback.next && (
            <div style={{ background: "var(--card)", borderRadius: 12, padding: 12, fontSize: 14 }}>
              <strong>Next step:</strong> {feedback.next}
            </div>
          )}
        </section>
      )}

      <div className="row rise" style={{ animationDelay: "0.2s" }}>
        <button
          className="btn big"
          style={{ flex: 1, borderColor: "var(--ink)" }}
          disabled={!text.trim()}
          onClick={() => void getFeedback()}
        >
          <Icon
            name={feedback === "loading" ? "loader" : "sparkle"}
            size={16}
            className={feedback === "loading" ? "spin" : undefined}
          />
          Writing coach
        </button>
        <button
          className="btn big primary"
          style={{ flex: 1, animation: "glow 2.4s ease-in-out infinite" }}
          disabled={state === "loading"}
          onClick={() => setSheet(true)}
        >
          Hand in
        </button>
      </div>

      {sheet && (
        <HandInSheet
          hw={hw}
          flush={async () => {
            window.clearTimeout(timer.current);
            if (state === "saving" || !fileId.current) {
              await save();
            }
            await saving.current;
            return fileId.current;
          }}
          onClose={() => setSheet(false)}
        />
      )}
    </main>
  );
}

function SaveChip({ state, savedLabel }: { state: SaveState; savedLabel: string }) {
  if (state === "saving" || state === "loading") {
    return (
      <span className="chip saving">
        <Icon name="loader" size={13} className="spin" />
        {state === "loading" ? "Loading…" : "Saving…"}
      </span>
    );
  }
  if (state === "error") {
    return <span className="chip warm">Not saved</span>;
  }
  return (
    <span className="chip good pop">
      <Icon name="check" size={14} />
      {savedLabel}
    </span>
  );
}

function HandInSheet({
  hw,
  flush,
  onClose,
}: {
  hw: Homework;
  flush: () => Promise<string | null>;
  onClose: () => void;
}) {
  const { data, replaceHomework, handleError } = useApp();
  const [result, setResult] = useState<HandInResult | "working" | "error">("working");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await flush();
        const outcome = await data.handIn(hw, id);
        if (!cancelled) {
          setResult(outcome);
          replaceHomework({ ...hw, done: true });
        }
      } catch (err) {
        if (!cancelled) {
          setResult("error");
          handleError(err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once when the sheet opens.
  }, []);

  const done = result !== "working";
  return (
    <div className="backdrop" onClick={done ? onClose : undefined}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Hand in"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="h1" style={{ fontSize: 24 }}>
          {result === "turnedIn" ? "Handed in!" : "Handing in"}
        </h2>
        {result === "working" && (
          <div className="step">
            <Icon name="loader" size={22} className="spin" />
            Saving your work…
          </div>
        )}
        {result === "error" && (
          <div className="banner">
            Something went wrong. Your work is still saved; try again or finish in Classroom.
          </div>
        )}
        {(result === "turnedIn" || result === "openClassroom") && (
          <>
            <Step n="✓" ok delay={0.1}>
              {data.labels.workStep}
            </Step>
            <Step n="✓" ok delay={0.3}>
              {data.labels.tickedStep}
            </Step>
            {result === "turnedIn" ? (
              <Step n="✓" ok delay={0.5}>
                Turned in on Google Classroom
              </Step>
            ) : (
              <Step n="3" delay={0.5}>
                <span>
                  Last tap: attach your Doc and press <strong>Turn in</strong> on Classroom
                </span>
              </Step>
            )}
          </>
        )}
        {result !== "turnedIn" && (
          <a
            className="btn big primary rise"
            style={{ animationDelay: "0.7s" }}
            href={hw.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Classroom
          </a>
        )}
        <button className="btn ghost" onClick={onClose} disabled={!done}>
          {result === "turnedIn" ? "Done" : "Close"}
        </button>
      </div>
    </div>
  );
}

function Step({
  n,
  ok,
  delay,
  children,
}: {
  n: string;
  ok?: boolean;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <div className="step" style={{ animationDelay: `${delay}s` }}>
      <span
        className="step-dot"
        style={{
          animationDelay: `${delay + 0.05}s`,
          background: ok ? "var(--good-soft)" : "var(--accent-soft)",
          color: ok ? "var(--good)" : "var(--accent-ink)",
        }}
      >
        {n}
      </span>
      {children}
    </div>
  );
}
