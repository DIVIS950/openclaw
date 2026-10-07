import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ImageInput } from "../../shared/api.ts";
import { useApp } from "../context.ts";
import { imageSrc, photoToImageInput } from "../lib/image.ts";
import {
  KIND_LABEL,
  missing,
  saveSorted,
  SORT_KINDS,
  sortPost,
  type SortedItem,
  type SortKind,
} from "../lib/sorter.ts";
import { courses } from "../lib/store.ts";
import { dayOf } from "../lib/study.ts";
import { Icon } from "./Icon.tsx";

// The "Add anything" sheet: paste or photograph whatever you got, the AI sorts
// it into homework, tests, to-dos, calendar and notes, you check, then save.

export function AddAnythingButton({
  label = "Add anything",
  big = false,
  variant,
  onSaved,
}: {
  label?: string;
  big?: boolean;
  /** "fab": the raised centre button in the tab bar. */
  variant?: "fab";
  /** Lets the screen showing the lists reload them. */
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "fab" ? (
        <button className="nav-fab" aria-label={label} onClick={() => setOpen(true)}>
          <Icon name="plus" size={26} />
        </button>
      ) : big ? (
        <button className="btn block" onClick={() => setOpen(true)}>
          <Icon name="plus" size={16} />
          {label}
        </button>
      ) : (
        <button className="round" aria-label={label} onClick={() => setOpen(true)}>
          <Icon name="plus" size={18} />
        </button>
      )}
      {/* Portalled to the app root: an animated parent would otherwise trap the sheet under later cards. */}
      {open &&
        createPortal(
          <AddAnything onClose={() => setOpen(false)} onSaved={onSaved} />,
          document.querySelector(".app") ?? document.body,
        )}
    </>
  );
}

function summary(saved: Record<SortKind, number>): string {
  const parts = SORT_KINDS.filter((k) => saved[k] > 0).map(
    (k) =>
      `${saved[k]} ${KIND_LABEL[k].toLowerCase()}${saved[k] > 1 && k !== "homework" ? "s" : ""}`,
  );
  return parts.length ? `Saved ${parts.join(", ")}.` : "Nothing was saved.";
}

export function AddAnything({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const { ai, data, toast, handleError, reloadHomework } = useApp();
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<ImageInput[]>([]);
  const [items, setItems] = useState<SortedItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const today = dayOf(new Date());

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }
    try {
      const read = await Promise.all([...files].slice(0, 4).map(photoToImageInput));
      setPhotos((p) => [...p, ...read].slice(0, 4));
    } catch (err) {
      handleError(err);
    }
  };

  const sort = async () => {
    if (!ai) {
      toast("The AI isn't available here.");
      return;
    }
    setBusy(true);
    try {
      const found = await sortPost(ai, {
        text,
        images: photos,
        classes: courses.get().map((c) => c.name),
      });
      setItems(found);
      if (found.length === 0) {
        toast("I couldn't find anything to add. Try adding a bit more detail.");
      }
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const change = (i: number, patch: Partial<SortedItem>) =>
    setItems((list) => list?.map((it, j) => (j === i ? { ...it, ...patch } : it)) ?? null);

  const ready = (items ?? []).filter((it) => !missing(it, today));

  const save = async () => {
    setBusy(true);
    try {
      const saved = await saveSorted(ready, data, today, ai);
      if (saved.homework > 0) {
        reloadHomework();
      }
      toast(summary(saved));
      onSaved?.();
      onClose();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const textarea = useRef<HTMLTextAreaElement>(null);
  const pasteText = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim()) {
        setText((t) => (t.trim() ? `${t.trimEnd()}\n${clip}` : clip));
        return;
      }
    } catch {
      // No clipboard access: the box is there to paste into.
    }
    textarea.current?.focus();
  };
  const first = items?.[0];

  return (
    <div className="backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Add anything"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="between" style={{ alignItems: "center" }}>
          <div className="stack" style={{ gap: 4 }}>
            <h2 className="h1" style={{ fontSize: 24 }}>
              Add anything
            </h2>
            <span className="s13 muted">The AI sorts it. You confirm. It saves.</span>
          </div>
          <button className="round" aria-label="Close" disabled={busy} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {items === null ? (
          <>
            <div className="src-grid">
              <button className="src" disabled={busy} onClick={() => void pasteText()}>
                <span className="ico cyan" aria-hidden="true">
                  <Icon name="clipboard" size={20} />
                </span>
                Paste text
              </button>
              <button className="src" disabled={busy} onClick={() => camera.current?.click()}>
                <span className="ico magenta" aria-hidden="true">
                  <Icon name="camera" size={20} />
                </span>
                Take a photo
              </button>
              <button className="src" disabled={busy} onClick={() => textarea.current?.focus()}>
                <span className="ico violet" aria-hidden="true">
                  <Icon name="keyboard" size={20} />
                </span>
                Type
              </button>
            </div>
            <label className="stack" style={{ gap: 6 }}>
              <span className="eyebrow">What is it?</span>
              <textarea
                ref={textarea}
                className="field"
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Science hw: finish respiration Qs 1–8 for Thursday"
                aria-label="What is it?"
              />
            </label>
            {photos.length > 0 && (
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {photos.map((p, i) => (
                  <button
                    key={i}
                    className="round"
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 14,
                      overflow: "hidden",
                      padding: 0,
                    }}
                    aria-label="Remove photo"
                    onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))}
                  >
                    <img
                      src={imageSrc(p)}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </button>
                ))}
              </div>
            )}
            <input
              ref={camera}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void addPhotos(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="row" style={{ gap: 10 }}>
              <button
                className="btn primary"
                style={{ flex: 1 }}
                disabled={busy || (!text.trim() && photos.length === 0)}
                onClick={() => void sort()}
              >
                <Icon
                  name={busy ? "loader" : "sparkle"}
                  size={18}
                  className={busy ? "spin" : undefined}
                />
                {busy ? "Sorting…" : "Sort it for me"}
              </button>
            </div>
          </>
        ) : (
          <>
            {items.map((it, i) => {
              const problem = missing(it, today);
              return (
                <div key={i} className="stack pop sorted-item" style={{ gap: 10 }}>
                  <div className="between" style={{ alignItems: "center" }}>
                    <span className="eyebrow row" style={{ color: "var(--accent-t)", gap: 6 }}>
                      <Icon name="sparkle" size={14} />
                      AI sorted it as
                    </span>
                    <span className="s12 muted">Tap to change</span>
                  </div>
                  <div
                    className="row"
                    role="radiogroup"
                    aria-label="Type"
                    style={{ gap: 8, overflowX: "auto" }}
                  >
                    {SORT_KINDS.map((k) => (
                      <button
                        key={k}
                        role="radio"
                        aria-checked={it.kind === k}
                        className="kind"
                        onClick={() => change(i, { kind: k })}
                      >
                        {KIND_LABEL[k] === "Calendar" ? "Event" : KIND_LABEL[k]}
                      </button>
                    ))}
                  </div>
                  <div className="card kv-card">
                    <div className="kv">
                      <span className="k">Title</span>
                      <input
                        className="v"
                        value={it.title}
                        onChange={(e) => change(i, { title: e.target.value })}
                        aria-label="Title"
                      />
                    </div>
                    <div className="kv">
                      <span className="k">Subject</span>
                      <input
                        className="v chip subject"
                        value={it.subject}
                        onChange={(e) => change(i, { subject: e.target.value })}
                        placeholder="Class"
                        aria-label="Class"
                        style={{ flex: "none", width: 120, textAlign: "center" }}
                      />
                    </div>
                    {it.kind !== "note" && (
                      <div className="kv">
                        <span className="k">{it.kind === "homework" ? "Due" : "Date"}</span>
                        <input
                          className="v"
                          type="date"
                          lang="en-GB"
                          value={it.date}
                          onChange={(e) => change(i, { date: e.target.value })}
                          aria-label={it.kind === "homework" ? "Due date" : "Date"}
                        />
                      </div>
                    )}
                    {it.details && it.kind !== "todo" && (
                      <div className="kv" style={{ alignItems: "flex-start" }}>
                        <span className="k">Details</span>
                        <span
                          className="v s12 clip"
                          style={{ fontWeight: 500, whiteSpace: "normal" }}
                        >
                          {it.details.slice(0, 140)}
                        </span>
                      </div>
                    )}
                  </div>
                  {problem && (
                    <div className="fix-text" style={{ fontSize: 13, fontWeight: 600 }}>
                      {problem}
                    </div>
                  )}
                  {items.length > 1 && (
                    <button
                      className="btn link"
                      style={{ alignSelf: "flex-end" }}
                      onClick={() => setItems((list) => list?.filter((_, j) => j !== i) ?? null)}
                    >
                      Remove this one
                    </button>
                  )}
                </div>
              );
            })}
            <div className="row" style={{ gap: 10 }}>
              <button
                className="btn"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => setItems(null)}
              >
                Change
              </button>
              <button
                className="btn primary"
                style={{ flex: 1.3 }}
                disabled={busy || ready.length === 0}
                onClick={() => void save()}
              >
                {busy
                  ? "Saving…"
                  : items.length === 1 && first
                    ? `Save to ${KIND_LABEL[first.kind]}`
                    : `Save ${ready.length === items.length ? "all" : ready.length}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
