import { useEffect, useRef, useState } from "react";
import { FocusButton } from "../components/FocusTimer.tsx";
import { Icon } from "../components/Icon.tsx";
import { StartTask } from "../components/StartTask.tsx";
import { useAiContext, useApp } from "../context.ts";
import { writingFeedback, type Feedback } from "../lib/aiFeatures.ts";
import { makeCanvaDesign } from "../lib/canva.ts";
import { dueLabel } from "../lib/format.ts";
import { photoToImageInput } from "../lib/image.ts";
import {
  applyEdits,
  POLISH_AREAS,
  polishWork,
  type PolishArea,
  type PolishResult,
} from "../lib/polish.ts";
import type { HandInResult, Homework } from "../lib/types.ts";

type SaveState = "loading" | "saved" | "saving" | "error";

const SAVE_DELAY_MS = 1200;

export function Assignment({ hw }: { hw: Homework }) {
  const { data, go, ai, handleError, toast } = useApp();
  const [text, setText] = useState("");
  const [state, setState] = useState<SaveState>("loading");
  const [link, setLink] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [polish, setPolish] = useState<"handin" | "only" | null>(null);
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
          {hw.source === "Classroom" && (
            <a
              href={hw.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, fontWeight: 600 }}
            >
              Open in Classroom
            </a>
          )}
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

      <StartTask
        hw={hw}
        work={text}
        onInsert={(outline) => onChange(text.trim() ? `${text.trimEnd()}\n\n${outline}` : outline)}
      />

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
          style={{ flex: 1 }}
          disabled={state === "loading"}
          onClick={() => (text.trim() ? setPolish("handin") : setSheet(true))}
        >
          Hand in
        </button>
      </div>
      <FocusButton title={hw.title} />
      <CheckPhotoButton title={hw.title} course={hw.course} />
      <button
        className="btn block rise"
        disabled={!text.trim() || state === "loading"}
        onClick={() => setPolish("only")}
      >
        <Icon name="wand" size={16} />
        Polish my work
      </button>

      {polish && (
        <PolishSheet
          hw={hw}
          text={text}
          forHandIn={polish === "handin"}
          onApply={(next) => {
            if (next !== text) {
              onChange(next);
              toast("Changes added to your work.");
            }
            setPolish(null);
          }}
          onHandIn={() => {
            setPolish(null);
            setSheet(true);
          }}
          onClose={() => setPolish(null)}
        />
      )}

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

/** Photo of written answers → the tutor marks them, question by question. */
function CheckPhotoButton({ title, course }: { title: string; course: string }) {
  const { ai, askTutor, handleError, toast } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!ai) {
    return null;
  }
  return (
    <>
      <button
        className="btn block rise"
        disabled={busy}
        onClick={() => input.current?.click()}
        aria-label="Check my answers from a photo"
      >
        <Icon name={busy ? "loader" : "camera"} size={16} className={busy ? "spin" : undefined} />
        Check my answers (photo)
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={async (e) => {
          const files = e.target.files;
          if (!files?.length) {
            return;
          }
          setBusy(true);
          try {
            const images = await Promise.all(Array.from(files).map(photoToImageInput));
            toast("Sending your answers to the tutor…");
            askTutor(
              `These are my answers for "${title}" (${course}). Check each one: say which are right, ` +
                "and for each wrong one give a hint so I can fix it myself.",
              "check",
              images,
            );
          } catch (err) {
            handleError(err);
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }}
      />
    </>
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

/** Asks what to polish, then shows every suggested change for the student to accept or skip. */
function PolishSheet({
  hw,
  text,
  forHandIn,
  onApply,
  onHandIn,
  onClose,
}: {
  hw: Homework;
  text: string;
  forHandIn: boolean;
  onApply: (text: string) => void;
  onHandIn: () => void;
  onClose: () => void;
}) {
  const { ai, handleError } = useApp();
  const [areas, setAreas] = useState<PolishArea[]>(["spelling"]);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<PolishResult | "working" | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [canva, setCanva] = useState<Record<number, string | "working">>({});

  const run = async () => {
    if (!ai) {
      return;
    }
    setResult("working");
    try {
      setResult(await polishWork(ai, hw, text, areas, note));
      setOff(new Set());
    } catch (err) {
      setResult(null);
      handleError(err);
    }
  };

  const accepted = result && result !== "working" ? result.edits.filter((_, i) => !off.has(i)) : [];
  const apply = () => onApply(applyEdits(text, accepted));

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Polish your work"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="h1" style={{ fontSize: 24 }}>
          {forHandIn ? "Polish before handing in?" : "Polish your work"}
        </h2>

        {result === null && (
          <>
            <p className="sub">What should I polish? You'll see every change before it's used.</p>
            <div className="stack" style={{ gap: 8 }}>
              {POLISH_AREAS.map((a) => (
                <label key={a.id} className="polish-area">
                  <input
                    type="checkbox"
                    checked={areas.includes(a.id)}
                    onChange={(e) =>
                      setAreas(
                        e.target.checked ? [...areas, a.id] : areas.filter((x) => x !== a.id),
                      )
                    }
                  />
                  <span className="stack" style={{ gap: 2 }}>
                    <strong>{a.label}</strong>
                    <span className="muted">{a.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <label className="stack" style={{ gap: 6 }}>
              <span className="h2">Anything else? (optional)</span>
              <input
                className="field"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. make my intro stronger"
              />
            </label>
            {!ai && (
              <div className="banner">Polishing needs the AI; open the app on claude.ai.</div>
            )}
            <button
              className="btn big primary"
              disabled={!ai || areas.length === 0 || !text.trim()}
              onClick={() => void run()}
            >
              <Icon name="sparkle" size={16} />
              Polish
            </button>
            {forHandIn && (
              <button className="btn" onClick={onHandIn}>
                Hand in without polishing
              </button>
            )}
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </>
        )}

        {result === "working" && (
          <div className="row muted" style={{ padding: "24px 0", justifyContent: "center" }}>
            <Icon name="loader" size={18} className="spin" />
            Reading your work…
          </div>
        )}

        {result && result !== "working" && (
          <>
            {result.edits.length === 0 &&
            result.tips.length === 0 &&
            result.visuals.length === 0 ? (
              <p className="sub">Nothing to change. It already reads well!</p>
            ) : (
              <p className="sub">Tap a change to skip it. Only the ones you keep are used.</p>
            )}
            <div className="stack" style={{ gap: 8 }}>
              {result.edits.map((e, i) => (
                <button
                  key={i}
                  className={`polish-edit${off.has(i) ? " off" : ""}`}
                  style={{ textAlign: "left", background: "var(--card)", color: "var(--ink)" }}
                  aria-pressed={!off.has(i)}
                  onClick={() => {
                    const next = new Set(off);
                    if (next.has(i)) {
                      next.delete(i);
                    } else {
                      next.add(i);
                    }
                    setOff(next);
                  }}
                >
                  <Icon name={off.has(i) ? "close" : "check"} size={18} />
                  <span className="stack" style={{ gap: 4, minWidth: 0 }}>
                    <span>
                      <del>{e.before}</del> → <ins>{e.after}</ins>
                    </span>
                    <span className="muted">
                      {POLISH_AREAS.find((a) => a.id === e.area)?.label}
                      {e.why ? `: ${e.why}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {result.tips.length > 0 && (
              <section className="ai-card">
                <h3>Structure tips</h3>
                <ul className="ai-list">
                  {result.tips.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </section>
            )}
            {result.visuals.length > 0 && (
              <section className="stack" style={{ gap: 8 }}>
                <h3 className="h2">Visual ideas</h3>
                {result.visuals.map((v, i) => (
                  <div key={i} className="card stack" style={{ gap: 8 }}>
                    <span>
                      {v.idea} <span className="muted">({v.format})</span>
                    </span>
                    {typeof canva[i] === "string" && canva[i] !== "working" ? (
                      <a
                        className="btn small"
                        href={canva[i]}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open in Canva
                      </a>
                    ) : (
                      <button
                        className="btn small"
                        disabled={canva[i] === "working"}
                        onClick={async () => {
                          setCanva((c) => ({ ...c, [i]: "working" }));
                          try {
                            const link = await makeCanvaDesign(
                              `${v.idea}. For a Year 9 student's homework "${hw.title}" (${hw.course}). Clean, simple, school-appropriate.`,
                              v.format,
                            );
                            setCanva((c) => ({ ...c, [i]: link }));
                          } catch (err) {
                            setCanva((c) => {
                              const next = { ...c };
                              delete next[i];
                              return next;
                            });
                            handleError(err);
                          }
                        }}
                      >
                        <Icon
                          name={canva[i] === "working" ? "loader" : "palette"}
                          size={14}
                          className={canva[i] === "working" ? "spin" : undefined}
                        />
                        {canva[i] === "working" ? "Making it in Canva…" : "Make it in Canva"}
                      </button>
                    )}
                  </div>
                ))}
              </section>
            )}
            {forHandIn ? (
              <>
                <button
                  className="btn big primary"
                  onClick={() => {
                    apply();
                    onHandIn();
                  }}
                >
                  {accepted.length ? `Use ${accepted.length} changes and hand in` : "Hand in"}
                </button>
                {accepted.length > 0 && (
                  <button className="btn" onClick={apply}>
                    Use changes, don't hand in yet
                  </button>
                )}
              </>
            ) : (
              <button className="btn big primary" disabled={accepted.length === 0} onClick={apply}>
                Use {accepted.length} changes
              </button>
            )}
            <button className="btn ghost" onClick={() => setResult(null)}>
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
