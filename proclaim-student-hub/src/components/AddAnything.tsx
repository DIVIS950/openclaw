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

const KIND_ICON = {
  homework: "homework",
  test: "flag",
  todo: "todo",
  event: "calendar",
  note: "note",
} as const;

export function AddAnythingButton({
  label = "Add anything",
  big = false,
  onSaved,
}: {
  label?: string;
  big?: boolean;
  /** Lets the screen showing the lists reload them. */
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {big ? (
        <button className="btn block primary" onClick={() => setOpen(true)}>
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

  return (
    <div className="backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Add anything"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="h1" style={{ fontSize: 24 }}>
          Add anything
        </h2>
        {items === null ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Paste a Classroom post, a message from a teacher or your own words (“Spanish test
              Friday, bring PE kit tomorrow”), or take a photo. The AI sorts it into homework,
              tests, to-dos, calendar and notes.
            </p>
            <textarea
              className="field"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste or type here…"
              aria-label="What to add"
            />
            {photos.length > 0 && (
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {photos.map((p, i) => (
                  <button
                    key={i}
                    className="round"
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 12,
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
            <div className="row">
              <button className="btn" onClick={() => camera.current?.click()} disabled={busy}>
                <Icon name="camera" size={16} />
                Photo
              </button>
              <button
                className="btn primary"
                style={{ flex: 1 }}
                disabled={busy || (!text.trim() && photos.length === 0)}
                onClick={() => void sort()}
              >
                <Icon
                  name={busy ? "loader" : "sparkle"}
                  size={16}
                  className={busy ? "spin" : undefined}
                />
                {busy ? "Sorting…" : "Sort it for me"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Check it's right. Tap a type to change it.
            </p>
            <div className="stack" style={{ gap: 10 }}>
              {items.map((it, i) => {
                const problem = missing(it, today);
                return (
                  <div key={i} className="card stack sorted-item" style={{ gap: 8, padding: 12 }}>
                    <div className="kind-row" role="radiogroup" aria-label="Type">
                      {SORT_KINDS.map((k) => (
                        <button
                          key={k}
                          role="radio"
                          aria-checked={it.kind === k}
                          className="kind-chip"
                          onClick={() => change(i, { kind: k })}
                        >
                          <Icon name={KIND_ICON[k]} size={13} />
                          {KIND_LABEL[k]}
                        </button>
                      ))}
                    </div>
                    <input
                      className="field"
                      value={it.title}
                      onChange={(e) => change(i, { title: e.target.value })}
                      aria-label="Title"
                    />
                    <div className="row">
                      <input
                        className="field"
                        type="date"
                        value={it.date}
                        onChange={(e) => change(i, { date: e.target.value })}
                        aria-label={it.kind === "homework" ? "Due date" : "Date"}
                        style={{ flex: 1 }}
                      />
                      <input
                        className="field"
                        value={it.subject}
                        onChange={(e) => change(i, { subject: e.target.value })}
                        placeholder="Class"
                        aria-label="Class"
                        style={{ flex: 1 }}
                      />
                      <button
                        className="round"
                        style={{ width: 36, height: 36, flex: "none" }}
                        aria-label={`Remove "${it.title}"`}
                        onClick={() => setItems((list) => list?.filter((_, j) => j !== i) ?? null)}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                    {it.details && it.kind !== "todo" && (
                      <div
                        className="muted"
                        style={{
                          fontSize: 13,
                          whiteSpace: "pre-wrap",
                          maxHeight: 90,
                          overflow: "auto",
                        }}
                      >
                        {it.details}
                      </div>
                    )}
                    {problem && (
                      <div className="warm-text" style={{ fontSize: 13, fontWeight: 600 }}>
                        {problem}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              className="btn big primary"
              disabled={busy || ready.length === 0}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : `Save ${ready.length === items.length ? "all" : ready.length}`}
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => setItems(null)}>
              ‹ Back
            </button>
          </>
        )}
        {items === null && (
          <button className="btn ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
