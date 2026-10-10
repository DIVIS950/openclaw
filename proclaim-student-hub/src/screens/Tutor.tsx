import { useEffect, useRef, useState } from "react";
import type { ChatTurn, ImageInput, TutorMode } from "../../shared/api.ts";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { imageSrc, photoToImageInput } from "../lib/image.ts";
import { newId, notes } from "../lib/study.ts";
import { canListen, canSpeak, listen, speak, stopSpeaking } from "../lib/voice.ts";

const MODES: { id: TutorMode; label: string }[] = [
  { id: "explain", label: "Explain" },
  { id: "check", label: "Check my answer" },
  { id: "quiz", label: "Quiz me" },
  { id: "eli10", label: "Like I'm 10" },
  { id: "summary", label: "Summary" },
];

/** The chip in the header: what this chat can "see" (the screen you came from). */
function seesLabel(context: string): string {
  const first = context.split(/[.;:]/)[0]?.trim() ?? "";
  return first.replace(/ screen$/i, "").slice(0, 40) || "this screen";
}

// The conversation survives switching tabs (but not closing the app).
// `failed` holds the positions of answers that are error messages, not help.
let savedChat: { mode: TutorMode; turns: ChatTurn[]; failed: number[] } = {
  mode: "explain",
  turns: [],
  failed: [],
};

export function Tutor() {
  const app = useApp();
  // The next open homework, offered as the first thing to ask about.
  const nextHw = (app.homework ?? [])
    .filter((h) => !h.done && h.due)
    .toSorted((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))[0];
  const [mode, setMode] = useState<TutorMode>(savedChat.mode);
  const [turns, setTurns] = useState<ChatTurn[]>(savedChat.turns);
  const [failed, setFailed] = useState<number[]>(savedChat.failed);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<ImageInput[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const handledSeed = useRef<number | null>(null);

  useEffect(() => {
    savedChat = { mode, turns, failed };
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mode, turns, failed]);

  useEffect(
    () => () => {
      abort.current?.abort();
      stopSpeaking();
    },
    [],
  );
  const [listening, setListening] = useState<(() => void) | null>(null);

  const talk = () => {
    if (listening) {
      listening();
      return;
    }
    const session = listen((partial) => setInput(partial));
    setListening(() => session.stop);
    session.done.then(
      (heard) => {
        setListening(null);
        if (heard) {
          void send(heard, images, mode);
        }
      },
      (err: unknown) => {
        setListening(null);
        app.handleError(err);
      },
    );
  };

  const send = async (text: string, pics: ImageInput[], sendMode: TutorMode) => {
    if ((!text.trim() && pics.length === 0) || busy) {
      return;
    }
    const history: ChatTurn[] = [
      ...turns,
      { role: "user", text: text.trim() || "Please help with this.", images: pics },
    ];
    setTurns([...history, { role: "assistant", text: "" }]);
    setInput("");
    setImages([]);

    const ai = app.ai;
    if (!ai) {
      setFailed((f) => [...f, history.length]);
      setTurns([
        ...history,
        {
          role: "assistant",
          text: "The AI needs you signed in: on the web link, open it signed in to Claude; on the full app, sign in with Google.",
        },
      ]);
      return;
    }

    setBusy(true);
    abort.current = new AbortController();
    try {
      // Only the newest photos are sent in full; older ones were already discussed.
      const trimmed = history.map((t, i) =>
        i < history.length - 1 ? { ...t, images: undefined } : t,
      );
      await ai.tutor(
        sendMode,
        trimmed,
        (soFar: string) => setTurns([...history, { role: "assistant", text: soFar }]),
        abort.current.signal,
      );
    } catch (err) {
      if (!abort.current.signal.aborted) {
        setFailed((f) => [...f, history.length]);
        setTurns([
          ...history,
          { role: "assistant", text: err instanceof Error ? err.message : "Something went wrong." },
        ]);
        app.handleError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  // A request from another screen ("Help me", "AI check", "Plan my evening").
  useEffect(() => {
    const seed = app.tutorSeed;
    if (seed && handledSeed.current !== seed.key) {
      handledSeed.current = seed.key;
      setMode(seed.mode);
      void send(seed.text, seed.images ?? [], seed.mode);
    }
  }, [app.tutorSeed]);

  const addPhotos = async (files: FileList | null) => {
    if (!files) {
      return;
    }
    try {
      const picked = await Promise.all(
        [...files].slice(0, 4 - images.length).map(photoToImageInput),
      );
      setImages((prev) => [...prev, ...picked].slice(0, 4));
    } catch (err) {
      app.handleError(err);
    }
  };

  const last = turns[turns.length - 1];
  const lastFailed = failed.includes(turns.length - 1);
  const saveToNotes = (text: string) => {
    const id = newId("n");
    notes.upsert({
      id,
      title: text.split(/[.\n]/)[0]?.slice(0, 60) || "From study buddy",
      subject: "",
      body: text,
      updatedAt: new Date().toISOString(),
      packId: "",
      kind: "ai",
    });
    app.toast("Saved to Notes.");
  };

  return (
    <>
      <header className="stack buddy-head">
        <div className="between" style={{ gap: 10 }}>
          <h1 className="h1" style={{ fontSize: 36 }}>
            AI help
          </h1>
          {app.aiContext && (
            <span className="chip cyan" style={{ maxWidth: "58%" }}>
              <Icon name="eye" size={14} />
              <span className="clip">Sees: {seesLabel(app.aiContext)}</span>
            </span>
          )}
        </div>
        <div className="modes" role="tablist" aria-label="How should it help">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              className={mode === m.id ? "mode on" : "mode"}
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
          {turns.length > 0 && (
            <button
              type="button"
              className="mode"
              onClick={() => {
                abort.current?.abort();
                setTurns([]);
                setFailed([]);
              }}
            >
              New chat
            </button>
          )}
        </div>
      </header>
      <main className="screen buddy-body" style={{ gap: 12, paddingTop: 8 }} aria-live="polite">
        {turns.length === 0 && (
          <section className="card buddy-empty rise" aria-label="Start">
            <span className="buddy-badge" aria-hidden="true">
              <Icon name="sparkles" size={28} />
            </span>
            <h2 className="h2" style={{ fontSize: 24, fontWeight: 800 }}>
              What are you stuck on?
            </h2>
            <p className="muted buddy-hint" style={{ margin: 0 }}>
              Ask about any homework, snap a photo of a question, or pick one below.
            </p>
            <div className="qr">
              {[
                ...(nextHw ? [`Help me start "${nextHw.title}"`] : []),
                "Explain how to solve 3x + 7 = 22",
                "Quiz me on the causes of World War One",
                "What makes a good essay introduction?",
              ].map((q) => (
                <button key={q} className="qrb" onClick={() => void send(q, [], mode)}>
                  {q}
                </button>
              ))}
            </div>
          </section>
        )}
        {turns.map((t, i) =>
          t.role === "assistant" && !t.text ? (
            <div key={i} className="bubble ai typing" aria-label="Study Buddy is typing">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <div
              key={i}
              className={`bubble ${t.role === "user" ? "me" : "ai"}${failed.includes(i) ? " err" : ""}`}
              role={failed.includes(i) ? "alert" : undefined}
            >
              {t.role === "assistant" && !failed.includes(i) && (
                <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                  <span className="chip violet">
                    <Icon name="sparkle" size={14} />
                    {MODES.find((m) => m.id === mode)?.label ?? "Explain"}
                  </span>
                  {turns[i - 1]?.images?.length ? (
                    <span className="s12 muted">from your photo</span>
                  ) : null}
                </div>
              )}
              {t.images?.map((img, j) => (
                <img key={j} src={imageSrc(img)} alt="Your photo" />
              ))}
              {t.text}
              {t.role === "assistant" &&
                !failed.includes(i) &&
                canSpeak() &&
                !(busy && i === turns.length - 1) && (
                  <button
                    className="link-btn"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      minHeight: 32,
                      fontSize: 13,
                    }}
                    onClick={() => speak(t.text)}
                  >
                    <Icon name="speaker" size={16} />
                    Read aloud
                  </button>
                )}
            </div>
          ),
        )}
        {/* Follow-ups only after a real answer, never after an error message. */}
        {!busy && last?.role === "assistant" && last.text && !lastFailed && (
          <div className="row pop" style={{ flexWrap: "wrap", gap: 6 }}>
            <button className="btn" onClick={() => saveToNotes(last.text)}>
              <Icon name="save" size={18} />
              Save to Notes
            </button>
            <button
              className="btn"
              onClick={() => void send("Make 3 practice questions on this.", [], "quiz")}
            >
              Make 3 questions
            </button>
            <button
              className="btn"
              onClick={() => void send("Explain that again, simpler.", [], "eli10")}
            >
              Simpler
            </button>
          </div>
        )}
        <div ref={bottom} />
      </main>

      {images.length > 0 && (
        <div className="row" style={{ padding: "8px 16px 0", gap: 8 }}>
          {images.map((img, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img
                src={imageSrc(img)}
                alt="Photo to send"
                style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 10 }}
              />
              <button
                className="round"
                aria-label="Remove photo"
                style={{ position: "absolute", top: -8, right: -8, width: 24, height: 24 }}
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input, images, mode);
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void addPhotos(e.target.files)}
        />
        <button
          type="button"
          className="round"
          aria-label="Photo of a question"
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="camera" size={20} />
        </button>
        <label htmlFor="ask" className="sr-only">
          Your question
        </label>
        <textarea
          id="ask"
          className="field"
          rows={1}
          style={{ minHeight: 48, maxHeight: 120, padding: "13px 16px", resize: "none" }}
          value={input}
          placeholder="Ask anything…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input, images, mode);
            }
          }}
        />
        {canListen() && (
          <button
            type="button"
            className={`round${listening ? " mic" : ""}`}
            aria-label={listening ? "Stop listening" : "Talk"}
            onClick={talk}
          >
            <Icon name="mic" size={20} />
          </button>
        )}
        <button
          type="submit"
          className="round send"
          aria-label="Send"
          disabled={busy || (!input.trim() && images.length === 0)}
        >
          <Icon name="arrowUp" size={20} />
        </button>
      </form>
    </>
  );
}
