import { Check, Copy, ExternalLink, ImagePlus, Images, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Listing } from "../../shared/types.ts";
import { api, copyText, photoResolver, photoUrl } from "../lib/api.ts";
import { prepareForUpload } from "../lib/image.ts";
import { savePhotos } from "../lib/saveFile.ts";
import { Button, cx } from "./ui.tsx";

type Style = "clean" | "studio";

// What we ask the Gemini app for. "Clean" must never change the item itself: buyers and the
// marketplaces need the real thing, wear and defects included.
const PROMPTS: Record<Style, string> = {
  clean:
    "Edit this photo for a second-hand marketplace listing. Keep the exact same item: do not change its shape, colour, logos, text, wear, scratches or any defect. Remove the background and put the item on a clean, soft light-grey studio background with a gentle natural shadow. Fix the white balance, brightness and sharpness. Keep the same camera angle. Give me one square photo.",
  studio:
    "Make a beautiful product photo of this exact item for a marketplace listing. Keep the item identical: same shape, colour, logos, text, wear and defects. Place it in a tasteful, softly lit scene that suits it (for example a wooden table or a cosy shelf), with a softly blurred background. Give me one square photo.",
};

/**
 * Hands one photo to the Gemini app on the phone (covered by the user's Google plan) and takes the
 * edited photo back. Nothing is sent from here: the user shares the photo into Gemini themselves.
 */
export function GeminiApp({ listing, onChange, disabled }: { listing: Listing; onChange: (l: Listing) => void; disabled: boolean }) {
  const [style, setStyle] = useState<Style>("clean");
  const [photo, setPhoto] = useState(0);
  const [file, setFile] = useState<Blob | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const n = listing.photos.length;

  // The original photo gives Gemini the most to work with. Loaded early: iPhone Safari only opens
  // the share sheet straight after a tap, with no waiting in between.
  useEffect(() => {
    setFile(null);
    setSaved(false);
    let live = true;
    fetch(photoResolver.resolve(`/photos/${listing.id}/${listing.photos[photo]}`))
      .then((r) => r.blob())
      .then((b) => live && setFile(b))
      .catch(() => live && setError("Couldn't load the photo."));
    return () => {
      live = false;
    };
  }, [listing.id, listing.photos, photo]);

  const save = () => {
    if (!file) return;
    void savePhotos([{ name: `snapsell-${listing.id}-${photo + 1}.jpg`, blob: file }]).then(setSaved);
  };

  const copy = async () => {
    setCopied(await copyText(PROMPTS[style]));
  };

  // Gemini's photo replaces this photo's edited version; the other photos keep theirs.
  const applyResult = async (picked: File) => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const blobs = await Promise.all(
        listing.photos.map(async (_, i) => (i === photo ? prepareForUpload(picked) : fetch(photoUrl(listing, i)).then((r) => r.blob()))),
      );
      onChange(await api.uploadEnhanced(listing.id, blobs));
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const step = (num: number, done: boolean, text: string) => (
    <span className="flex items-center gap-2 text-[13px] font-bold">
      <span className={cx("grid size-5 place-items-center rounded-full text-[11px] text-white", done ? "bg-ok" : "bg-ink")}>
        {done ? <Check className="size-3" /> : num}
      </span>
      {text}
    </span>
  );

  return (
    <div className="mt-5 rounded-[14px] bg-card p-3.5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-accent" />
        <div className="flex-1">
          <div className="font-bold">Improve in the Gemini app</div>
          <div className="text-[12px] text-muted">Free with your Google plan. You share the photo yourself.</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Gemini style">
        {(
          [
            ["clean", "Clean up", "Keeps it real"],
            ["studio", "AI studio", "Nice scene"],
          ] as const
        ).map(([id, label, hint]) => (
          <button
            key={id}
            role="radio"
            aria-checked={style === id}
            onClick={() => {
              setStyle(id);
              setCopied(false);
            }}
            className={cx("rounded-2xl bg-paper px-3 py-2 text-left", style === id ? "ring-2 ring-accent" : "ring-1 ring-line")}
          >
            <span className="block text-sm font-bold">{label}</span>
            <span className="block text-xs text-muted">{hint}</span>
          </button>
        ))}
      </div>
      {style === "studio" && (
        <p className="mt-2 text-[12px] text-muted">Tip: use it as the first, eye-catching photo and keep real photos after it. Sites can remove listings with only AI pictures.</p>
      )}

      {n > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto" role="radiogroup" aria-label="Which photo">
          {listing.photos.map((_, i) => (
            <button
              key={i}
              role="radio"
              aria-checked={photo === i}
              aria-label={`Photo ${i + 1}`}
              onClick={() => setPhoto(i)}
              className={cx("size-14 shrink-0 overflow-hidden rounded-xl", photo === i ? "ring-2 ring-ink" : "opacity-70")}
            >
              <img src={photoUrl(listing, i, false)} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {step(1, saved, "Save the photo and copy the instruction")}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="soft" onClick={save} disabled={!file || disabled}>
            {file ? <Images className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
            {saved ? "Saved" : "Save photo"}
          </Button>
          <Button variant="soft" onClick={copy} disabled={disabled}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {step(2, false, "In Gemini: add the photo, paste, send, then save its photo")}
        <a
          href="https://gemini.google.com/app"
          target="_blank"
          rel="noreferrer"
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-accent text-[16px] font-semibold text-white"
        >
          <ExternalLink className="size-4" />
          Open Gemini
        </a>
        {step(3, false, "Come back and pick Gemini's photo")}
        <Button variant="accent" className="w-full" loading={busy} disabled={disabled} onClick={() => input.current?.click()}>
          <ImagePlus className="size-4" />
          Use Gemini's photo{n > 1 ? ` for photo ${photo + 1}` : ""}
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void applyResult(f);
          }}
        />
      </div>
      {done && <p className="mt-2 text-sm font-semibold text-ok">Gemini's photo is now in your listing.</p>}
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
