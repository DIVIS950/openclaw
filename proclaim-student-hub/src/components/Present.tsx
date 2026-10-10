import { useState } from "react";
import { useApp } from "../context.ts";
import { deckBrief, makeGammaDeck } from "../lib/gamma.ts";
import type { Homework } from "../lib/types.ts";
import { Icon } from "./Icon.tsx";

/** "Slides" on Do it here: the AI turns the task and your notes into a Gamma deck. */
export function PresentButton({ hw, text }: { hw: Homework; text: string }) {
  const { toast, handleError } = useApp();
  const [open, setOpen] = useState(false);
  const [slides, setSlides] = useState(8);
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const make = async () => {
    setBusy(true);
    try {
      const brief = deckBrief(
        hw.title,
        hw.description,
        [text, extra].filter(Boolean).join("\n\n"),
        slides,
      );
      const made = await makeGammaDeck(brief, slides);
      if (made) {
        setLink(made);
      } else {
        toast("Brief copied. Paste it into Gamma and press Generate.");
        setOpen(false);
      }
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>
        <Icon name="palette" size={14} />
        Slides
      </button>
      {open && (
        <div className="backdrop" onClick={busy ? undefined : () => setOpen(false)}>
          <section
            className="sheet"
            role="dialog"
            aria-label="Make a presentation"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="between" style={{ alignItems: "center" }}>
              <h2 className="h1" style={{ fontSize: 28 }}>
                Make slides
              </h2>
              <button
                className="round"
                aria-label="Close"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Gamma builds a presentation from this task and what you wrote. You can change
              everything in Gamma after.
            </p>
            <div
              className="card"
              style={{ padding: 14, display: "flex", flexDirection: "column", gap: 4 }}
            >
              <span className="eyebrow">Topic</span>
              <strong>{hw.title}</strong>
              <span className="muted s13">
                {text.trim()
                  ? `Uses your ${text.trim().split(/\s+/).length} words`
                  : "Nothing written yet: Gamma writes it from the task"}
              </span>
            </div>
            <label className="stack" style={{ gap: 6 }}>
              <span className="eyebrow">Anything to add?</span>
              <textarea
                className="field in"
                rows={3}
                value={extra}
                placeholder="e.g. make it fun, include a quiz at the end"
                onChange={(e) => setExtra(e.target.value)}
              />
            </label>
            <div className="between">
              <span className="eyebrow">Slides</span>
              <div className="seg3" role="radiogroup" aria-label="Number of slides">
                {[5, 8, 12].map((n) => (
                  <button
                    key={n}
                    role="radio"
                    aria-checked={slides === n}
                    className={slides === n ? "on" : undefined}
                    onClick={() => setSlides(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {link ? (
              <a className="btn primary" href={link} target="_blank" rel="noopener noreferrer">
                <Icon name="external" size={18} />
                Open your presentation
              </a>
            ) : (
              <button className="btn primary" disabled={busy} onClick={() => void make()}>
                <Icon
                  name={busy ? "loader" : "sparkle"}
                  size={18}
                  className={busy ? "spin" : undefined}
                />
                {busy ? "Gamma is making it… (about a minute)" : "Make it with Gamma"}
              </button>
            )}
          </section>
        </div>
      )}
    </>
  );
}
