import { useState } from "react";
import type { TutorMessage } from "../lib/study.ts";
import { Icon } from "./Icon.tsx";

/**
 * The student ↔ tutor conversation. Messages travel inside the links the two
 * sides swap, so a new one is "sent" with the next share. `me` says which
 * side is reading, so their own lines sit on the right.
 */
export function MessageThread({
  messages,
  me,
  otherName,
  placeholder,
  onSend,
  pending = 0,
  autoFocus = false,
}: {
  messages: TutorMessage[];
  me: TutorMessage["from"];
  otherName: string;
  placeholder: string;
  onSend: (text: string) => void;
  /** How many of mine are written but not yet in a link. */
  pending?: number;
  /** Put the cursor in the message box (opened from a "Message" button). */
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const send = () => {
    if (text.trim()) {
      onSend(text.trim());
      setText("");
    }
  };
  return (
    <section className="card stack" style={{ gap: 10 }} aria-label="Messages">
      <div className="between">
        <h2 className="h2">Messages</h2>
        {pending > 0 && <span className="chip accent">{pending} to send</span>}
      </div>
      {messages.length === 0 ? (
        <p className="sub">No messages yet. Write one and it goes with your next link.</p>
      ) : (
        <div className="thread">
          {messages
            .toSorted((a, b) => a.at.localeCompare(b.at))
            .slice(-30)
            .map((m) => (
              <div key={m.id} className={`msg${m.from === me ? " mine" : ""}`}>
                <span className="msg-who">
                  {m.from === me ? "You" : otherName} ·{" "}
                  {new Date(m.at).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="msg-text">{m.text}</span>
              </div>
            ))}
        </div>
      )}
      <form
        className="row"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label="New message"
          autoFocus={autoFocus}
        />
        <button
          className="round dark"
          type="submit"
          aria-label="Add message"
          disabled={!text.trim()}
        >
          <Icon name="send" size={18} />
        </button>
      </form>
    </section>
  );
}
