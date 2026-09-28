import { useEffect, useRef, useState } from "react";
import type { ChatTurn, ImageInput, TutorMode } from "../../shared/api.ts";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { imageSrc, photoToImageInput } from "../lib/image.ts";
import { canListen, canSpeak, listen, speak, stopSpeaking } from "../lib/voice.ts";

const MODES: { id: TutorMode; label: string }[] = [
  { id: "explain", label: "Explain" },
  { id: "check", label: "Check" },
  { id: "quiz", label: "Quiz me" },
  { id: "summary", label: "Summary" },
];

// The conversation survives switching tabs (but not closing the app).
let savedChat: { mode: TutorMode; turns: ChatTurn[] } = { mode: "explain", turns: [] };

export function Tutor() {
  const app = useApp();
  const [mode, setMode] = useState<TutorMode>(savedChat.mode);
  const [turns, setTurns] = useState<ChatTurn[]>(savedChat.turns);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<ImageInput[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const handledSeed = useRef<number | null>(null);

  useEffect(() => {
    savedChat = { mode, turns };
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mode, turns]);

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
      void send(seed.text, [], seed.mode);
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

  return (
    <>
      <header
        className="stack"
        style={{
          padding: "calc(env(safe-area-inset-top) + 20px) 20px 12px",
          gap: 12,
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="between">
          <div>
            <h1 className="h1" style={{ fontSize: 28 }}>
              Study buddy
            </h1>
            <p className="sub" style={{ fontSize: 13 }}>
              Helps you understand, not just copy.
            </p>
          </div>
          <div className="row">
            {app.ai && (
              <button
                className="btn small primary"
                onClick={() => app.go("call")}
                aria-label="Voice call with your study buddy"
              >
                <Icon name="mic" size={14} />
                Talk
              </button>
            )}
            <button className="btn small" onClick={() => app.go("revise")}>
              <Icon name="camera" size={14} />
              Revision Lab
            </button>
            {turns.length > 0 && (
              <button
                className="btn small ghost"
                onClick={() => {
                  abort.current?.abort();
                  setTurns([]);
                }}
              >
                New
              </button>
            )}
          </div>
        </div>
        <div
          className="segmented"
          role="tablist"
          aria-label="Mode"
          style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      <main className="screen" style={{ gap: 12, paddingTop: 16 }} aria-live="polite">
        {turns.length === 0 && (
          <div className="stack rise" style={{ gap: 8 }}>
            <p className="sub">Ask about any homework, or snap a photo of a question.</p>
            {[
              "Explain how to solve 3x + 7 = 22",
              "Quiz me on the causes of World War One",
              "What makes a good essay introduction?",
            ].map((q) => (
              <button
                key={q}
                className="btn"
                style={{ justifyContent: "flex-start", textAlign: "left" }}
                onClick={() => void send(q, [], mode)}
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "assistant" && !t.text ? (
            <div key={i} className="bubble ai typing" aria-label="Study Buddy is typing">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <div key={i} className={`bubble ${t.role === "user" ? "me" : "ai"}`}>
              {t.images?.map((img, j) => (
                <img key={j} src={imageSrc(img)} alt="Your photo" />
              ))}
              {t.text}
              {t.role === "assistant" && canSpeak() && !(busy && i === turns.length - 1) && (
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
        {!busy && last?.role === "assistant" && last.text && mode === "explain" && (
          <div className="row pop" style={{ flexWrap: "wrap" }}>
            <button
              className="btn small"
              onClick={() => void send("Give me a similar question to try.", [], mode)}
            >
              Give me a similar one
            </button>
            <button className="btn small" onClick={() => void send("Quiz me on this.", [], "quiz")}>
              Quiz me on this
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
        {canListen() && (
          <button
            type="button"
            className={`round${listening ? " dark" : ""}`}
            aria-label={listening ? "Stop listening" : "Talk"}
            onClick={talk}
          >
            <Icon name="mic" size={20} className={listening ? "wiggle" : undefined} />
          </button>
        )}
        <button
          type="button"
          className="round"
          aria-label="Add a photo"
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
          style={{
            borderRadius: 22,
            minHeight: 44,
            maxHeight: 120,
            padding: "11px 16px",
            resize: "none",
          }}
          value={input}
          placeholder="Ask about any homework…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input, images, mode);
            }
          }}
        />
        <button
          type="submit"
          className="round dark"
          aria-label="Send"
          disabled={busy || (!input.trim() && images.length === 0)}
        >
          <Icon name="send" size={18} />
        </button>
      </form>
    </>
  );
}
