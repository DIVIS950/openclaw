import { useEffect, useRef, useState } from "react";
import { FocusButton } from "../components/FocusTimer.tsx";
import { Icon } from "../components/Icon.tsx";
import { PresentButton } from "../components/Present.tsx";
import { StartTask } from "../components/StartTask.tsx";
import { useAiContext, useApp } from "../context.ts";
import { writingFeedback, type Feedback } from "../lib/aiFeatures.ts";
import { makeCanvaDesign } from "../lib/canva.ts";
import { draftCopy, pickDraft } from "../lib/draftCopy.ts";
import { dueLabel } from "../lib/format.ts";
import { photoToImageInput } from "../lib/image.ts";
import {
  applyEdits,
  POLISH_AREAS,
  polishWork,
  type PolishArea,
  type PolishResult,
} from "../lib/polish.ts";
import { subjectTone } from "../lib/subjects.ts";
import type { HandInResult, Homework } from "../lib/types.ts";
import { useEscape } from "../lib/useEscape.ts";
import { makeGoogleDoc } from "../pages/googleDocs.ts";

type SaveState = "loading" | "saved" | "saving" | "error";

const SAVE_DELAY_MS = 1200;

export function Assignment({ hw }: { hw: Homework }) {
  const { data, back, ai, handleError, toast, openAi } = useApp();
  const [text, setText] = useState("");
  const [state, setState] = useState<SaveState>("loading");
  const [link, setLink] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [polish, setPolish] = useState<"handin" | "only" | null>(null);
  const fileId = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  // Saves run one at a time so the first save's new file id is used by the next.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef("");
  // Typing that the real save hasn't been asked to keep yet.
  const pending = useRef(false);

  useEffect(() => {
    data.loadDraft(hw).then(
      (draft) => {
        fileId.current = draft.fileId;
        // Typing that never reached the real save (closed, reloaded, rotated) wins.
        const pick = pickDraft(draft.text, draftCopy.get(hw.id));
        latest.current = pick.text;
        setText(pick.text);
        setLink(draft.link);
        if (pick.unsaved) {
          pending.current = true;
          setState("saving");
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(save, 300);
        } else {
          setState("saved");
        }
      },
      (err: unknown) => {
        // Show what this device still has, so nothing typed looks lost.
        const copy = draftCopy.get(hw.id);
        if (copy) {
          latest.current = copy.text;
          setText(copy.text);
        }
        setState("error");
        handleError(err);
      },
    );
    return () => window.clearTimeout(timer.current);
    // `save` only reads refs and this homework.
  }, [data, hw, handleError]);

  const save = () => {
    pending.current = false;
    saving.current = saving.current.then(async () => {
      const snapshot = latest.current;
      try {
        const draft = await data.saveDraft(hw, snapshot, fileId.current);
        fileId.current = draft.fileId;
        draftCopy.saved(hw.id, snapshot);
        setLink(draft.link);
        if (latest.current === snapshot) {
          setState("saved");
          setSavedAt(Date.now());
        }
      } catch (err) {
        setState("error");
        handleError(err);
      }
    });
    return saving.current;
  };

  // Save straight away when the page is hidden, closed or this screen goes away.
  const flushRef = useRef(() => {});
  flushRef.current = () => {
    if (pending.current) {
      window.clearTimeout(timer.current);
      void save();
    }
  };
  useEffect(() => {
    const flush = () => flushRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, []);

  const onChange = (value: string) => {
    setText(value);
    latest.current = value;
    pending.current = true;
    // A copy on this device on every keystroke, in case the page closes first.
    draftCopy.set(hw.id, value);
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

  const saveText =
    state === "loading"
      ? "Loading…"
      : state === "saving"
        ? "Saving…"
        : state === "error"
          ? "Not saved"
          : `Autosaved${savedAgo(savedAt)}`;

  return (
    <main className="screen" style={{ gap: 14, position: "static" }}>
      <header className="stack rise" style={{ gap: 12 }}>
        <div className="between">
          <button className="round" aria-label="Back to homework" onClick={() => back("homework")}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <div className="row" style={{ gap: 8, minWidth: 0, justifyContent: "flex-end" }}>
            {hw.course && (
              <span className={`chip tone-${subjectTone(hw.course)}`}>{hw.course}</span>
            )}
            <span
              className={`chip${hw.due && new Date(hw.due).getTime() - Date.now() < 36 * 3600_000 ? " due" : ""}`}
            >
              {dueLabel(hw.due)}
            </span>
          </div>
        </div>
        <h1 className="h1" style={{ fontSize: 30 }}>
          {hw.title}
        </h1>
        <div className="do-steps" aria-label="Progress">
          {["Read brief", "Write it", "Hand in"].map((label, i) => {
            // "Read brief" only counts as done when there was a brief to read.
            const at = words > 0 ? 2 : hw.description ? 1 : 0;
            return (
              <div key={label} className={i < at ? "dstep done" : i === at ? "dstep now" : "dstep"}>
                <i />
                {label}
              </div>
            );
          })}
        </div>
      </header>

      {!hw.description && (
        <section className="card stack rise d1 no-brief" style={{ padding: 16, gap: 8 }}>
          <span className="eyebrow">From your teacher</span>
          <p className="s13" style={{ margin: 0, color: "var(--ink2)", lineHeight: 1.45 }}>
            No instructions were copied here.{" "}
            {hw.link
              ? `Open it in ${sourceName(hw)} to see what to do.`
              : `Check ${sourceName(hw)} for what to do.`}
          </p>
          {hw.link && (
            <a
              className="btn sm"
              style={{ alignSelf: "flex-start" }}
              href={hw.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="external" size={14} />
              Open in {sourceName(hw)}
            </a>
          )}
        </section>
      )}

      {hw.description && (
        <section className="card stack rise d1" style={{ padding: 16, gap: 8 }}>
          <div className="between">
            <span className="eyebrow">From your teacher</span>
            {hw.link ? (
              <a className="s12" href={hw.link} target="_blank" rel="noopener noreferrer">
                {hw.source} ›
              </a>
            ) : (
              <span className="s12 muted">{hw.source}</span>
            )}
          </div>
          <p style={{ margin: 0, color: "var(--ink2)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {hw.description}
          </p>
        </section>
      )}

      <section className="card stack rise d2" style={{ padding: 16, gap: 10 }}>
        <div className="between">
          <h2 className="h2">Your answer</h2>
          <span className="row s12 muted" style={{ gap: 6 }} role="status">
            <span
              className="save-dot"
              style={
                state === "error" ? { background: "var(--pink)", boxShadow: "none" } : undefined
              }
              aria-hidden="true"
            />
            {saveText} · {words} {words === 1 ? "word" : "words"}
          </span>
        </div>
        <label className="muted s13" htmlFor="work">
          {link
            ? "Write straight here. It saves as you type, into your Google Doc too."
            : "Write straight here, it saves as you type."}
        </label>
        <textarea
          id="work"
          className="ans"
          rows={7}
          value={text}
          disabled={state === "loading"}
          placeholder={state === "loading" ? "Loading your work…" : "Start typing."}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (state === "saving") {
              window.clearTimeout(timer.current);
              void save();
            }
          }}
        />
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn sm"
            disabled={!text.trim() || feedback === "loading"}
            onClick={() => void getFeedback()}
          >
            <Icon
              name={feedback === "loading" ? "loader" : "sparkle"}
              size={14}
              className={feedback === "loading" ? "spin" : undefined}
            />
            Get feedback
          </button>
          {link ? (
            <a className="btn sm" href={link} target="_blank" rel="noopener noreferrer">
              <Icon name="doc" size={14} />
              Open Google Doc
            </a>
          ) : (
            <button
              className="btn sm"
              disabled={!text.trim() || state === "loading"}
              onClick={() =>
                makeGoogleDoc(hw, text).then((made) => {
                  if (made) {
                    setLink(made);
                    toast("Saved as a Google Doc. It keeps updating as you type.");
                  } else {
                    toast("Copied. Paste it into the new Google Doc.");
                  }
                }, handleError)
              }
            >
              <Icon name="doc" size={14} />
              Google Doc
            </button>
          )}
          <CheckPhotoButton title={hw.title} course={hw.course} />
          <PresentButton hw={hw} text={text} />
          <button
            className="btn sm"
            disabled={!text.trim() || state === "loading"}
            onClick={() => setPolish("only")}
          >
            <Icon name="wand" size={14} />
            Polish
          </button>
        </div>
        {!text.trim() && state !== "loading" && (
          <p className="s12 muted" style={{ margin: 0 }}>
            Write something first: then Get feedback, Google Doc and Polish work.
          </p>
        )}
      </section>

      <StartTask
        hw={hw}
        work={text}
        onInsert={(outline) => onChange(text.trim() ? `${text.trimEnd()}\n\n${outline}` : outline)}
      />

      {feedback && feedback !== "loading" && (
        <section
          className="card hero violet pop"
          style={{ padding: "14px 16px", gap: 10 }}
          aria-label="AI feedback"
        >
          <div className="row" style={{ gap: 8 }}>
            <span className="chip violet">
              <Icon name="sparkle" size={14} />
              AI feedback
            </span>
            <span className="s12 muted">on your answer</span>
          </div>
          {feedback.good.length > 0 && (
            <div style={{ fontSize: 14, lineHeight: 1.45 }}>
              <strong className="ok-text">Works: </strong>
              {feedback.good.join(" ")}
            </div>
          )}
          {feedback.improve.map((f, i) => (
            <div key={i} style={{ fontSize: 14, lineHeight: 1.45 }}>
              <strong>{f.point}</strong>
              {f.hint ? ` ${f.hint}` : ""}
            </div>
          ))}
          {feedback.spelling.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              {feedback.spelling.map((sp, i) => (
                <div key={i} className="between" style={{ fontSize: 14 }}>
                  <span>
                    <s className="fix-text">{sp.wrong}</s> → <strong>{sp.right}</strong>
                  </span>
                  {text.includes(sp.wrong) && (
                    <button
                      className="btn sm"
                      onClick={() => {
                        onChange(text.replace(sp.wrong, sp.right));
                        setFeedback({
                          ...feedback,
                          spelling: feedback.spelling.filter((x) => x !== sp),
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
            <div style={{ fontSize: 14, lineHeight: 1.45 }}>
              <strong>Next: </strong>
              {feedback.next}
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn sm"
              style={{ color: "var(--violet-t)" }}
              onClick={() =>
                openAi({
                  question:
                    "Explain why the feedback on my answer is right, simply, with one example.",
                })
              }
            >
              Show me why
            </button>
            <button
              className="btn sm"
              style={{ marginLeft: "auto" }}
              onClick={() => setFeedback(null)}
            >
              Fixed it
            </button>
          </div>
        </section>
      )}

      <div className="dock">
        <FocusButton title={hw.title} label="Focus 25" className="btn" />
        <button
          className="btn primary"
          style={{ flex: 1 }}
          disabled={state === "loading"}
          onClick={() => (text.trim() ? setPolish("handin") : setSheet(true))}
        >
          Hand in
        </button>
      </div>

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
          empty={!text.trim()}
          flush={async () => {
            window.clearTimeout(timer.current);
            if (state === "saving" || !fileId.current) {
              await save();
            }
            await saving.current;
            if (text.trim() && !fileId.current) {
              throw new Error("Your work couldn't be saved to Google, so it wasn't handed in yet.");
            }
            return fileId.current;
          }}
          onClose={() => setSheet(false)}
        />
      )}
    </main>
  );
}

/** "Classroom", "Dr Frost"… or "its app" for "Other". */
function sourceName(hw: Homework): string {
  return hw.source === "Other" ? "its app" : hw.source;
}

/** " just now" / " 2 min ago" after "Autosaved". */
function savedAgo(at: number | null): string {
  if (!at) {
    return "";
  }
  const mins = Math.round((Date.now() - at) / 60_000);
  return mins < 1 ? " just now" : ` ${mins} min ago`;
}

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
        className="btn sm"
        disabled={busy}
        onClick={() => input.current?.click()}
        aria-label="Check my answers from a photo"
      >
        <Icon name={busy ? "loader" : "camera"} size={14} className={busy ? "spin" : undefined} />
        Check from photo
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
  empty,
  flush,
  onClose,
}: {
  hw: Homework;
  /** Nothing written: ask before marking it done, and don't talk about a Doc. */
  empty: boolean;
  flush: () => Promise<string | null>;
  onClose: () => void;
}) {
  const { data, replaceHomework, handleError } = useApp();
  const [result, setResult] = useState<HandInResult | "confirm" | "working" | "error">(
    empty ? "confirm" : "working",
  );
  const confirmed = result !== "confirm";
  useEscape(onClose, result !== "working");

  useEffect(() => {
    if (!confirmed) {
      return;
    }
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
    // Run once, when the sheet opens (or once "Mark as done" is tapped).
  }, [confirmed]);

  const done = result !== "working";
  if (result === "confirm") {
    return (
      <div className="backdrop" onClick={onClose}>
        <div
          className="sheet"
          role="dialog"
          aria-label="Hand in"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="h1" style={{ fontSize: 24 }}>
            Nothing written
          </h2>
          <p className="sub" style={{ margin: 0 }}>
            Your answer is empty. Mark it as done anyway? If it was done on paper or somewhere else,
            that's fine.
          </p>
          <button className="btn big primary" onClick={() => setResult("working")}>
            Mark as done
          </button>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="backdrop" onClick={done ? onClose : undefined}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Hand in"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="h1" style={{ fontSize: 24 }}>
          {result === "turnedIn"
            ? "Handed in!"
            : empty && result === "openClassroom"
              ? "Marked as done"
              : "Handing in"}
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
            {!empty && (
              <Step n="✓" ok delay={0.1}>
                {data.labels.workStep}
              </Step>
            )}
            <Step n="✓" ok delay={0.3}>
              {data.labels.tickedStep}
            </Step>
            {result === "turnedIn" ? (
              <Step n="✓" ok delay={0.5}>
                Turned in on Google Classroom
              </Step>
            ) : empty ? (
              hw.link && (
                <Step n="2" delay={0.5}>
                  <span>
                    If it needs handing in, press <strong>Turn in</strong> on Classroom
                  </span>
                </Step>
              )
            ) : (
              <Step n="3" delay={0.5}>
                <span>
                  Last tap: attach your Doc and press <strong>Turn in</strong> on Classroom
                </span>
              </Step>
            )}
          </>
        )}
        {result !== "turnedIn" && hw.link && (
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
  useEscape(onClose, result !== "working");

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
