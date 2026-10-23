import { useEffect, useRef, useState } from "react";
import type { ChatTurn } from "../../shared/api.ts";
import { useApp } from "../context.ts";
import { helperInstructions } from "../lib/aiFeatures.ts";
import { useEscape } from "../lib/useEscape.ts";
import { canListen, canSpeak, listen, speak, stopSpeaking } from "../lib/voice.ts";
import { Icon } from "./Icon.tsx";
import { NoAiKeyNote } from "./NoAiKeyNote.tsx";
import { Overlay } from "./Overlay.tsx";

/** The AI helper: a chat that opens over the current screen, so nothing navigates away. */
export function AskAi({
  context,
  question,
  onClose,
}: {
  context: string;
  question?: string;
  onClose: () => void;
}) {
  const { ai, go, handleError } = useApp();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState<(() => void) | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  useEscape(onClose);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  useEffect(
    () => () => {
      abort.current?.abort();
      stopSpeaking();
    },
    [],
  );

  const send = async (text: string) => {
    if (!text.trim() || busy) {
      return;
    }
    const history: ChatTurn[] = [...turns, { role: "user", text: text.trim() }];
    setTurns([...history, { role: "assistant", text: "" }]);
    setInput("");
    if (!ai) {
      setTurns([
        ...history,
        {
          role: "assistant",
          text: "The AI needs you signed in. Open the app signed in to Claude.",
        },
      ]);
      return;
    }
    setBusy(true);
    abort.current = new AbortController();
    try {
      await ai.chat(
        helperInstructions(context),
        history,
        (soFar) => setTurns([...history, { role: "assistant", text: soFar }]),
        abort.current.signal,
      );
    } catch (err) {
      if (!abort.current.signal.aborted) {
        setTurns([
          ...history,
          { role: "assistant", text: err instanceof Error ? err.message : "Something went wrong." },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (question && !asked.current) {
      asked.current = true;
      void send(question);
    }
    // Only the question the helper was opened with.
  }, [question]);

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
          void send(heard);
        }
      },
      (err: unknown) => {
        setListening(null);
        handleError(err);
      },
    );
  };

  const suggestions = context
    ? ["Explain this to me", "What should I do first?", "Quiz me on this"]
    : ["Help me plan my homework", "Explain a maths topic", "Quiz me on something"];

  return (
    <Overlay>
      <div className="backdrop" onClick={onClose}>
        <div
          className="sheet"
          role="dialog"
          aria-label="Ask AI"
          style={{ height: "82%", padding: 0, gap: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="between"
            style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--line)" }}
          >
            <div className="row" style={{ gap: 8 }}>
              <span className="nav-ai" style={{ margin: 0, width: 36, height: 36, border: "none" }}>
                <Icon name="sparkle" size={18} />
              </span>
              <strong style={{ fontSize: 16 }}>Ask AI</strong>
            </div>
            <div className="row">
              <button
                className="btn small ghost"
                onClick={() => {
                  onClose();
                  go("tutor");
                }}
              >
                Full chat
              </button>
              <button className="round" aria-label="Close" onClick={onClose}>
                <Icon name="close" size={18} />
              </button>
            </div>
          </div>

          <div
            className="stack"
            style={{ flex: 1, overflowY: "auto", padding: "16px 20px", gap: 12 }}
            aria-live="polite"
          >
            {turns.length === 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <p className="sub">
                  Ask anything about what's on your screen, or tap the mic and talk.
                </p>
                <NoAiKeyNote onGo={onClose} />
                {suggestions.map((s) => (
                  <button
                    key={s}
                    className="btn"
                    style={{ justifyContent: "flex-start" }}
                    onClick={() => void send(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {turns.map((t, i) =>
              t.role === "assistant" && !t.text ? (
                <div key={i} className="bubble ai typing" aria-label="AI is typing">
                  <span />
                  <span />
                  <span />
                </div>
              ) : (
                <div key={i} className={`bubble ${t.role === "user" ? "me" : "ai"}`}>
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
            <div ref={bottom} />
          </div>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
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
            <label htmlFor="ask-ai" className="sr-only">
              Your question
            </label>
            <input
              id="ask-ai"
              className="field"
              style={{ borderRadius: 22 }}
              value={input}
              placeholder={listening ? "Listening…" : "Ask anything…"}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              className="round dark"
              aria-label="Send"
              disabled={busy || !input.trim()}
            >
              <Icon name="send" size={18} />
            </button>
          </form>
        </div>
      </div>
    </Overlay>
  );
}
