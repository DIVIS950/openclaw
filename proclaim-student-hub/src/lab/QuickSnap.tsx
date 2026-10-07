import { useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { photoToImageInput, smallCopy } from "../lib/image.ts";
import { dayString, type DocType, type LabPack } from "./model.ts";
import { scanPhotos } from "./scan.ts";
import type { LabSettings } from "./store.ts";

// The simplest way to revise: take a photo, and the pack is made. No form,
// no questions. The AI works out the subject and the topic itself.

const OPTIONS: { label: string; docType: DocType }[] = [
  { label: "Notes", docType: "notes" },
  { label: "Worksheet", docType: "worksheet" },
  { label: "Vocab list", docType: "textbook" },
  { label: "Diagram", docType: "diagram" },
];

export function QuickSnap({
  prefs,
  online,
  onSaved,
  onSample,
  onOptions,
}: {
  prefs: LabSettings;
  online: boolean;
  onSaved: (pack: LabPack) => void;
  /** Shown while there are no packs: loads the sample pack. */
  onSample?: () => void;
  /** Opens the full scan form (subject, type, text). */
  onOptions?: () => void;
}) {
  const { ai, handleError } = useApp();
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocType>("auto");

  const make = async (files: FileList | null) => {
    if (!files?.length || !ai) {
      return;
    }
    setBusy("Reading your photo…");
    try {
      const images = await Promise.all([...files].slice(0, 4).map(photoToImageInput));
      setBusy("Making flashcards, quiz and games…");
      const found = await scanPhotos(
        ai,
        { images, text: "", docType },
        prefs,
        dayString(new Date()),
      );
      if (found.items.length === 0) {
        throw new Error("Couldn't find anything to learn in that photo. Try a clearer one.");
      }
      const photo = await smallCopy(images[0]).catch(() => "");
      onSaved({
        ...found,
        id: `p${Date.now().toString(36)}`,
        createdAt: new Date().toISOString(),
        photo,
        labels: photo ? found.labels : [],
      });
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
      if (camera.current) {
        camera.current.value = "";
      }
    }
  };

  const ready = Boolean(ai) && online && busy === null;
  return (
    <section className="card snap-btn stack rise d1" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 14 }}>
        <button
          className="cam"
          disabled={!ready}
          onClick={() => camera.current?.click()}
          aria-label="Take a photo of a test or notes and make a revision pack"
        >
          <Icon name={busy ? "loader" : "camera"} size={28} className={busy ? "spin" : undefined} />
        </button>
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <span className="h2" style={{ fontSize: 17 }}>
            {busy ?? "Snap it, revise it"}
          </span>
          <span className="s12" style={{ color: "var(--text2)" }}>
            {busy
              ? "About 20 seconds"
              : !ai
                ? "Needs the AI key (More › AI key)"
                : !online
                  ? "Needs the internet"
                  : "Photo of notes, a worksheet or a vocab list becomes a full pack."}
          </span>
        </div>
      </div>
      <div className="opts">
        {OPTIONS.map((o) => (
          <button
            key={o.docType}
            className={`opt${docType === o.docType ? " on" : ""}`}
            aria-pressed={docType === o.docType}
            disabled={!ready}
            onClick={() => {
              setDocType(docType === o.docType ? "auto" : o.docType);
              camera.current?.click();
            }}
          >
            {o.label}
          </button>
        ))}
        {onSample ? (
          <button
            className="btn link"
            style={{ marginLeft: "auto", padding: "0 6px" }}
            onClick={onSample}
          >
            Sample pack
          </button>
        ) : (
          onOptions && (
            <button
              className="btn link"
              style={{ marginLeft: "auto", padding: "0 6px" }}
              onClick={onOptions}
            >
              Options
            </button>
          )
        )}
      </div>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => void make(e.target.files)}
      />
    </section>
  );
}
