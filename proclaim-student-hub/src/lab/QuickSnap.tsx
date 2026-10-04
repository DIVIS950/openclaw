import { useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { photoToImageInput, smallCopy } from "../lib/image.ts";
import { dayString, type LabPack } from "./model.ts";
import { scanPhotos } from "./scan.ts";
import type { LabSettings } from "./store.ts";

// The simplest way to revise: take a photo, and the pack is made. No form,
// no questions. The AI works out the subject and the topic itself.

export function QuickSnap({
  prefs,
  online,
  onSaved,
}: {
  prefs: LabSettings;
  online: boolean;
  onSaved: (pack: LabPack) => void;
}) {
  const { ai, handleError } = useApp();
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
        { images, text: "", docType: "auto" },
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

  return (
    <section className="snap rise">
      <button
        className="snap-btn"
        disabled={!ai || !online || busy !== null}
        onClick={() => camera.current?.click()}
        aria-label="Take a photo of a test or notes and make a revision pack"
      >
        <span className="snap-icon" aria-hidden="true">
          <Icon name={busy ? "loader" : "camera"} size={30} className={busy ? "spin" : undefined} />
        </span>
        <span className="stack" style={{ gap: 2, textAlign: "left" }}>
          <strong style={{ fontSize: 18 }}>{busy ?? "Snap it, revise it"}</strong>
          <span style={{ fontSize: 13, opacity: 0.8 }}>
            {busy
              ? "About 20 seconds"
              : !ai
                ? "Needs the AI key (Apps › AI key)"
                : !online
                  ? "Needs the internet"
                  : "Photo of a test, notes or a vocab list → cards, quiz, games"}
          </span>
        </span>
      </button>
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
