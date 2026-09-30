import { useEffect, useRef, useState } from "react";
import type { ImageInput } from "../../shared/api.ts";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { imageSrc, photoToImageInput, smallCopy } from "../lib/image.ts";
import {
  dayString,
  DOC_TYPES,
  newItem,
  SUBJECTS,
  type DocType,
  type Item,
  type LabPack,
  type Subject,
} from "./model.ts";
import { scanPhotos, type ScanResult } from "./scan.ts";
import type { LabSettings } from "./store.ts";

const MAX_PAGES = 4;

const DOC_LABELS: Record<DocType, string> = {
  auto: "Work it out",
  test: "Marked test",
  notes: "Class notes",
  worksheet: "Worksheet",
  textbook: "Textbook page",
  diagram: "Diagram",
};

const STEPS = [
  "Reading your pages",
  "Reading handwriting and teacher's marks",
  "Finding what went wrong",
  "Building your items",
  "Making the games",
];

/** Photos (up to 4 pages) or typed notes in, a reviewed pack out. */
/** Turns a stored photo (data URL) back into an image the AI can read. */
function fromDataUrl(url: string): ImageInput | null {
  const m = url.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/);
  return m ? { mediaType: m[1] as ImageInput["mediaType"], data: m[2] } : null;
}

export function Scan({
  prefs,
  online,
  onBack,
  onSave,
  initial,
}: {
  prefs: LabSettings;
  online: boolean;
  onBack: () => void;
  onSave: (pack: LabPack) => void;
  /** Filled in when another screen (a test, a note, tutoring) sent the material here. */
  initial?: { subject: Subject; topic: string; text: string; photos: string[] };
}) {
  const { ai, handleError } = useApp();
  const [images, setImages] = useState<ImageInput[]>(() =>
    (initial?.photos ?? []).flatMap((p) => fromDataUrl(p) ?? []).slice(0, MAX_PAGES),
  );
  const [text, setText] = useState(initial?.text ?? "");
  const [docType, setDocType] = useState<DocType>("auto");
  const [subject, setSubject] = useState<Subject | "">(initial?.subject ?? "");
  const [step, setStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  useAiContext("Revision Lab: scanning school work into a revision pack.");

  // The steps move on a timer while the AI works; they're a guide, not a measurement.
  const running = step !== null;
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(
      () => setStep((s) => (s === null ? s : Math.min(STEPS.length - 1, s + 1))),
      3500,
    );
    return () => window.clearInterval(timer);
  }, [running]);

  const add = async (files: FileList | null) => {
    if (!files) {
      return;
    }
    try {
      const picked = await Promise.all(
        [...files].slice(0, MAX_PAGES - images.length).map(photoToImageInput),
      );
      setImages((prev) => [...prev, ...picked].slice(0, MAX_PAGES));
    } catch (err) {
      handleError(err);
    }
  };

  const scan = async () => {
    if (!ai) {
      return;
    }
    setError(null);
    setStep(0);
    try {
      const found = await scanPhotos(
        ai,
        { images, text, docType, subject: subject || undefined },
        prefs,
        dayString(new Date()),
      );
      if (found.items.length === 0) {
        throw new Error(
          "Couldn't find anything to learn in that. Try a clearer photo, or type the notes.",
        );
      }
      setResult(initial?.topic ? { ...found, topic: initial.topic.slice(0, 80) } : found);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that. Try again.");
    } finally {
      setStep(null);
    }
  };

  if (result) {
    return (
      <Review
        result={result}
        onBack={() => setResult(null)}
        onSave={async (reviewed) => {
          const photo = images[0] ? await smallCopy(images[0]).catch(() => "") : "";
          onSave({
            ...reviewed,
            id: `p${Date.now().toString(36)}`,
            createdAt: new Date().toISOString(),
            photo,
            // Pins only make sense on the photo they were read from.
            labels: photo ? reviewed.labels : [],
          });
        }}
      />
    );
  }

  if (step !== null) {
    return (
      <main className="screen" aria-busy="true">
        <header className="stack rise" style={{ gap: 4 }}>
          <h1 className="h1">Making your pack</h1>
          <p className="sub">This takes about 20 seconds.</p>
        </header>
        <div className="card stack" style={{ gap: 14 }}>
          {STEPS.map((s, i) => (
            <div key={s} className={`step${i > step ? " muted" : ""}`}>
              <span className="step-dot">
                {i < step ? (
                  <Icon name="check" size={14} />
                ) : i === step ? (
                  <Icon name="loader" size={14} className="spin" />
                ) : null}
              </span>
              {s}
            </div>
          ))}
        </div>
        {images.length > 0 && (
          <div className="thumbs">
            {images.map((img, i) => (
              <img key={i} src={imageSrc(img)} alt={`Page ${i + 1}`} className="scanning" />
            ))}
          </div>
        )}
      </main>
    );
  }

  const ready = images.length > 0 || text.trim().length > 20;
  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 4 }}>
        <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onBack}>
          ‹ Revision Lab
        </button>
        <h1 className="h1">Scan</h1>
        {initial?.topic && <p className="sub">For: {initial.topic}</p>}
        <p className="sub">
          Photograph a marked test, notes, a worksheet or a diagram (up to {MAX_PAGES} pages). The
          AI reads handwriting and your teacher's marks.
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

      <div className="thumbs">
        {images.map((img, i) => (
          <div key={i} className="thumb pop">
            <img src={imageSrc(img)} alt={`Page ${i + 1}`} />
            <button
              className="round"
              aria-label={`Remove page ${i + 1}`}
              onClick={() => setImages(images.filter((_, j) => j !== i))}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
        {images.length < MAX_PAGES && (
          <>
            <button className="thumb add" onClick={() => camera.current?.click()}>
              <Icon name="camera" size={22} />
              {images.length ? "Next page" : "Camera"}
            </button>
            <button className="thumb add" onClick={() => gallery.current?.click()}>
              <Icon name="image" size={22} />
              Photos
            </button>
          </>
        )}
      </div>

      <label className="stack" style={{ gap: 6 }}>
        <span className="h2">What is it?</span>
        <select
          className="field"
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocType)}
        >
          {DOC_TYPES.map((d) => (
            <option key={d} value={d}>
              {DOC_LABELS[d]}
            </option>
          ))}
        </select>
      </label>
      <label className="stack" style={{ gap: 6 }}>
        <span className="h2">Subject</span>
        <select
          className="field"
          value={subject}
          onChange={(e) => setSubject(e.target.value as Subject | "")}
        >
          <option value="">Work it out</option>
          {SUBJECTS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="stack" style={{ gap: 6 }}>
        <span className="h2">Or type / paste notes</span>
        <textarea
          className="field"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. vocab list, key facts…"
        />
      </label>

      {error && (
        <div className="banner" role="alert">
          {error}
        </div>
      )}
      {!online ? (
        <div className="banner">
          You're offline. Scanning needs the internet; your packs still work.
        </div>
      ) : !ai ? (
        <div className="banner">
          The AI isn't connected here, so scanning is off. You can still practise your packs.
        </div>
      ) : (
        <button className="btn big primary" disabled={!ready} onClick={() => void scan()}>
          <Icon name="sparkle" size={18} />
          {error ? "Try again" : "Make my pack"}
        </button>
      )}
    </main>
  );
}

type Draft = Omit<LabPack, "id" | "createdAt" | "photo">;

/** The student checks what the AI read before it becomes a pack. */
function Review({
  result,
  onBack,
  onSave,
}: {
  result: ScanResult;
  onBack: () => void;
  onSave: (pack: Draft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(result);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useAiContext(
    `Reviewing a new ${draft.subject} pack "${draft.topic}": ` +
      draft.items.map((i) => `${i.prompt} = ${i.answer}`).join("; "),
  );

  const setItem = (id: string, patch: Partial<Item>) =>
    setDraft({ ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const wrong = draft.items.filter((i) => i.markedWrong).length;

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 4 }}>
        <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onBack}>
          ‹ Scan again
        </button>
        <h1 className="h1">Check your pack</h1>
        <p className="sub">Fix anything the AI read wrong, then save.</p>
      </header>

      <div className="card stack">
        <label className="stack" style={{ gap: 6 }}>
          <span className="h2">Topic</span>
          <input
            className="field"
            value={draft.topic}
            onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
          />
        </label>
        <label className="stack" style={{ gap: 6 }}>
          <span className="h2">Subject</span>
          <select
            className="field"
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value as Subject })}
          >
            {SUBJECTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <span className="chip">{DOC_LABELS[draft.docType]}</span>
          <span className="chip">{draft.items.length} items</span>
          {draft.testScore && <span className="chip warm">Test: {draft.testScore}</span>}
          {wrong > 0 && <span className="chip warm">{wrong} marked wrong</span>}
          {draft.steps.length > 0 && <span className="chip">{draft.steps.length} steps</span>}
          {draft.labels.length > 0 && <span className="chip">{draft.labels.length} labels</span>}
        </div>
      </div>

      {draft.insight && (
        <section className="ai-card">
          <h3>
            <Icon name="wand" size={16} />
            The big fix
          </h3>
          <textarea
            className="field"
            rows={3}
            value={draft.insight}
            aria-label="The big fix"
            onChange={(e) => setDraft({ ...draft, insight: e.target.value })}
          />
        </section>
      )}

      <div className="stack" style={{ gap: 8 }}>
        {draft.items.map((item) =>
          editing === item.id ? (
            <div key={item.id} className="card stack pop">
              <input
                className="field"
                aria-label="Question or term"
                value={item.prompt}
                onChange={(e) => setItem(item.id, { prompt: e.target.value })}
              />
              <input
                className="field"
                aria-label="Answer"
                value={item.answer}
                onChange={(e) => setItem(item.id, { answer: e.target.value })}
              />
              <label className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={item.markedWrong}
                  onChange={(e) => setItem(item.id, { markedWrong: e.target.checked })}
                />
                Marked wrong on my test
              </label>
              <button
                className="btn small primary"
                onClick={() => setEditing(null)}
                disabled={!item.prompt.trim() || !item.answer.trim()}
              >
                Done
              </button>
            </div>
          ) : (
            <div key={item.id} className="card review-item">
              <button
                className="review-text"
                onClick={() => setEditing(item.id)}
                aria-label={`Edit ${item.prompt}`}
              >
                <strong>{item.prompt}</strong>
                <span>{item.answer}</span>
                <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <span className={`chip${item.origin === "ai" ? " accent" : ""}`}>
                    {item.origin === "ai" ? "AI added" : "From photo"}
                  </span>
                  {item.markedWrong && (
                    <span className="chip warm">
                      Marked wrong{item.studentAnswer ? `: you wrote "${item.studentAnswer}"` : ""}
                    </span>
                  )}
                </span>
              </button>
              <button
                className="round"
                style={{ width: 32, height: 32, flexShrink: 0 }}
                aria-label={`Delete ${item.prompt}`}
                onClick={() =>
                  setDraft({ ...draft, items: draft.items.filter((i) => i.id !== item.id) })
                }
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ),
        )}
        <button
          className="btn block"
          onClick={() => {
            const item = newItem(
              { prompt: "", answer: "", origin: "photo" },
              dayString(new Date()),
            );
            setDraft({ ...draft, items: [...draft.items, item] });
            setEditing(item.id);
          }}
        >
          <Icon name="plus" size={16} />
          Add an item
        </button>
      </div>

      <button
        className="btn big primary"
        disabled={
          saving || draft.items.filter((i) => i.prompt.trim() && i.answer.trim()).length === 0
        }
        onClick={async () => {
          setSaving(true);
          await onSave({
            ...draft,
            topic: draft.topic.trim() || "Untitled pack",
            items: draft.items.filter((i) => i.prompt.trim() && i.answer.trim()),
          });
        }}
      >
        {saving && <Icon name="loader" size={18} className="spin" />}
        Save pack
      </button>
    </main>
  );
}
