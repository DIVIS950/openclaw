import { useRef, useState } from "react";
import type { ImageInput } from "../../shared/api.ts";
import { SAMPLE_PACK, type RevisionPack } from "../../shared/pack.ts";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { imageSrc, photoToImageInput } from "../lib/image.ts";
import { packs, progress } from "../lib/store.ts";

type Tab = "Summary" | "Flashcards" | "Quiz";

function packAsText(pack: RevisionPack): string {
  return [
    `${pack.topic} (${pack.subject})`,
    "",
    "Key points",
    ...pack.summary.map((s) => `• ${s}`),
    ...(pack.keyFact ? ["", `Remember: ${pack.keyFact}`] : []),
    "",
    "Flashcards",
    ...pack.flashcards.map((c) => `Q: ${c.q}\nA: ${c.a}`),
    "",
    "Made with Proclaim Student Hub",
  ].join("\n");
}

export function Revise() {
  const app = useApp();
  const [saved, setSaved] = useState(packs.current);
  const [making, setMaking] = useState(saved === null);

  if (making || !saved) {
    return (
      <NewNotes
        onCancel={saved ? () => setMaking(false) : undefined}
        onPack={async (pack) => {
          let driveLink: string | null = null;
          if (!app.data.demo) {
            try {
              driveLink = await app.data.saveNotes(`Revision: ${pack.topic}`, packAsText(pack));
            } catch (err) {
              app.handleError(err);
            }
          }
          const next = { pack, driveLink };
          packs.save(next);
          setSaved(next);
          setMaking(false);
          progress.add(10);
        }}
      />
    );
  }
  return <PackView pack={saved.pack} driveLink={saved.driveLink} onNew={() => setMaking(true)} />;
}

function NewNotes({
  onPack,
  onCancel,
}: {
  onPack: (pack: RevisionPack) => Promise<void>;
  onCancel?: () => void;
}) {
  const app = useApp();
  const [images, setImages] = useState<ImageInput[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  const add = async (files: FileList | null) => {
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

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!app.ai) {
        return;
      }
      await onPack(await app.ai.revise({ images, text }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make your revision pack.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 4 }}>
        {onCancel && (
          <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onCancel}>
            ‹ Back to my pack
          </button>
        )}
        <h1 className="h1">Post your notes</h1>
        <p className="sub">
          Snap your class notes or a worksheet. The AI turns them into a summary, flashcards, a quiz
          and games.
        </p>
      </header>

      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void add(e.target.files)}
      />
      <input
        ref={gallery}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void add(e.target.files)}
      />

      <div className="row rise" style={{ animationDelay: "0.08s" }}>
        <button
          className="btn big dark"
          style={{ flex: 1 }}
          onClick={() => camera.current?.click()}
          disabled={images.length >= 4}
        >
          <Icon name="camera" size={20} />
          Take photo
        </button>
        <button
          className="btn big"
          style={{ flex: 1 }}
          onClick={() => gallery.current?.click()}
          disabled={images.length >= 4}
        >
          <Icon name="image" size={20} />
          Choose
        </button>
      </div>

      {images.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          {images.map((img, i) => (
            <div key={i} className="pop" style={{ position: "relative" }}>
              <img
                src={imageSrc(img)}
                alt={`Notes photo ${i + 1}`}
                style={{ width: 76, height: 76, objectFit: "cover", borderRadius: 12 }}
              />
              <button
                className="round"
                aria-label="Remove photo"
                style={{ position: "absolute", top: -8, right: -8, width: 26, height: 26 }}
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <label className="stack rise" style={{ gap: 6, animationDelay: "0.12s" }}>
        <span className="h2">Or type / paste notes</span>
        <textarea
          className="field"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste notes here…"
        />
      </label>

      {error && (
        <div className="banner" role="alert">
          {error}
        </div>
      )}

      {app.ai ? (
        <button
          className="btn big primary block"
          disabled={busy || (images.length === 0 && !text.trim())}
          onClick={() => void make()}
        >
          {busy ? (
            <>
              <Icon name="loader" size={18} className="spin" />
              Making your pack… (about 30 seconds)
            </>
          ) : (
            <>
              <Icon name="sparkle" size={18} />
              Make my revision pack
            </>
          )}
        </button>
      ) : (
        <div className="banner">
          The AI needs you signed in: on the web link, open it signed in to Claude; on the full app,
          sign in with Google.
        </div>
      )}

      <button className="btn ghost" onClick={() => void onPack(SAMPLE_PACK)}>
        Try with sample notes (Photosynthesis)
      </button>
    </main>
  );
}

function PackView({
  pack,
  driveLink,
  onNew,
}: {
  pack: RevisionPack;
  driveLink: string | null;
  onNew: () => void;
}) {
  const { go } = useApp();
  const [tab, setTab] = useState<Tab>("Summary");

  return (
    <main className="screen" style={{ gap: 14 }}>
      <header className="between rise">
        <div className="stack" style={{ gap: 2 }}>
          <div className="eyebrow">From your notes</div>
          <h1 className="h1" style={{ fontSize: 26 }}>
            {pack.topic}
          </h1>
          <div className="muted">
            {pack.subject}
            {driveLink && (
              <>
                {" · "}
                <a href={driveLink} target="_blank" rel="noopener noreferrer">
                  Saved to Google Drive
                </a>
              </>
            )}
          </div>
        </div>
        <button className="btn small" onClick={onNew}>
          <Icon name="plus" size={14} />
          New notes
        </button>
      </header>

      <button
        className="card-dark row pop"
        style={{
          padding: "14px 16px",
          border: "none",
          textAlign: "left",
          gap: 12,
          borderRadius: 16,
          animationDelay: "0.1s",
        }}
        onClick={() => go("games")}
      >
        <span
          className="tile-icon"
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "var(--accent)",
            color: "#fff",
          }}
        >
          <Icon name="game" size={24} className="wiggle" />
        </span>
        <span style={{ flex: 1 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>
            Play games with these notes
          </span>
          <span style={{ display: "block", fontSize: 12, color: "#c9c4b8" }}>
            Match up · Speed round · Fill the gap
          </span>
        </span>
        <span aria-hidden="true" style={{ fontSize: 20 }}>
          ›
        </span>
      </button>

      <div
        className="segmented"
        role="tablist"
        style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
      >
        {(["Summary", "Flashcards", "Quiz"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Summary" && (
        <section className="card stack rise" style={{ fontSize: 15, lineHeight: 1.5 }}>
          <h2 className="h2">Key points</h2>
          {pack.summary.map((s, i) => (
            <div key={i} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
              <span style={{ color: "var(--accent)", fontWeight: 600 }}>{i + 1}</span>
              <div>{s}</div>
            </div>
          ))}
          {pack.keyFact && (
            <div
              style={{
                background: "var(--accent-soft)",
                color: "var(--accent-ink)",
                borderRadius: 12,
                padding: 12,
                fontWeight: 600,
                textAlign: "center",
              }}
            >
              {pack.keyFact}
            </div>
          )}
        </section>
      )}
      {tab === "Flashcards" && <Flashcards pack={pack} />}
      {tab === "Quiz" && <Quiz pack={pack} />}
    </main>
  );
}

function Flashcards({ pack }: { pack: RevisionPack }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = pack.flashcards[i];
  if (!card) {
    return <div className="card empty">No flashcards in this pack.</div>;
  }
  const next = (known: boolean) => {
    if (known) {
      progress.add(2);
    }
    setFlipped(false);
    setI((i + 1) % pack.flashcards.length);
  };
  return (
    <section className="stack rise">
      {/* A new key remounts the card so the flip animation plays each time. */}
      <button
        key={`${i}-${flipped}`}
        className={`flashcard${flipped ? " back" : ""}`}
        onClick={() => setFlipped(!flipped)}
        aria-label="Flip card"
      >
        <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.75 }}>
          {flipped ? "Answer" : "Question"} · {i + 1} of {pack.flashcards.length}
        </span>
        <span className="flashcard-text">{flipped ? card.a : card.q}</span>
        <span style={{ fontSize: 13, opacity: 0.75 }}>Tap to flip</span>
      </button>
      <div className="row">
        <button className="btn big" style={{ flex: 1 }} onClick={() => next(false)}>
          Still learning
        </button>
        <button className="btn big primary" style={{ flex: 1 }} onClick={() => next(true)}>
          I know it
        </button>
      </div>
    </section>
  );
}

function Quiz({ pack }: { pack: RevisionPack }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const q = pack.quiz[i];

  if (pack.quiz.length === 0) {
    return <div className="card empty">No quiz questions in this pack.</div>;
  }
  if (!q) {
    return (
      <section
        className="card-dark stack pop"
        style={{ alignItems: "center", textAlign: "center" }}
      >
        <div className="muted" style={{ color: "#c9c4b8" }}>
          Quiz done
        </div>
        <div style={{ fontFamily: "var(--serif)", fontSize: 44, fontWeight: 600 }}>
          {score}/{pack.quiz.length}
        </div>
        <button
          className="btn"
          onClick={() => {
            setI(0);
            setScore(0);
            setPicked(null);
          }}
        >
          Try again
        </button>
      </section>
    );
  }
  return (
    <section key={i} className="card stack rise">
      <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
        Question {i + 1} of {pack.quiz.length}
      </div>
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--serif)",
          fontSize: 21,
          fontWeight: 500,
          lineHeight: 1.3,
        }}
      >
        {q.question}
      </h2>
      {q.options.map((o, j) => {
        const cls =
          picked === null ? "" : j === q.answer ? " right" : picked === j ? " wrong shake-a" : "";
        return (
          <button
            key={j}
            className={`game-btn${cls}`}
            style={{ minHeight: 48 }}
            onClick={() => {
              if (picked !== null) {
                return;
              }
              setPicked(j);
              if (j === q.answer) {
                setScore(score + 1);
                progress.add(5);
              }
            }}
          >
            {o}
          </button>
        );
      })}
      {picked !== null && (
        <>
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
            {picked === q.answer ? "Correct! " : "Not quite. "}
            {q.explanation}
          </div>
          <button
            className="btn dark"
            onClick={() => {
              setPicked(null);
              setI(i + 1);
            }}
          >
            Next ›
          </button>
        </>
      )}
    </section>
  );
}
