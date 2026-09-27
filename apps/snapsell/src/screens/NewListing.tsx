import { Check, ImagePlus, Loader2, PenLine, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Listing } from "../../shared/types.ts";
import { useApp } from "../App.tsx";
import { Button, Sheet, cx } from "../components/ui.tsx";
import { api, formatPrice, pendingPhotos } from "../lib/api.ts";
import { enhancePhoto, prepareForUpload } from "../lib/image.ts";

type Shot = { id: string; file: Blob; url: string };
const MAX = 12;

const newShot = (file: Blob): Shot => ({ id: Math.random().toString(36).slice(2), file, url: URL.createObjectURL(file) });

export function NewListing() {
  const [shots, setShots] = useState<Shot[]>(() => {
    const s = pendingPhotos.files.slice(0, MAX).map(newShot);
    pendingPhotos.files = [];
    return s;
  });
  const [note, setNote] = useState("");
  // When the AI can't see photos in this app, the seller describes the item and we try again.
  const [described, setDescribed] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const { go } = useApp();

  if (running) {
    return (
      <Analyzing
        key={described ?? ""}
        shots={shots}
        note={described ? [described, note].filter(Boolean).join(". ") : note}
        textOnly={described !== null}
        onDescribe={setDescribed}
        onDone={(id) => go(`/l/${id}`, true)}
        onCancel={() => setRunning(false)}
      />
    );
  }
  return <CameraScreen shots={shots} setShots={setShots} note={note} setNote={setNote} onDone={() => setRunning(true)} />;
}

// ---------------------------------------------------------------- camera (design artboard 3)

const TIPS = [
  "Fill the frame with the item. Daylight near a window works best.",
  "Now the back, the label or the serial number.",
  "Add close-ups of any wear or flaws. Buyers trust honest photos.",
];

function CameraScreen({
  shots,
  setShots,
  note,
  setNote,
  onDone,
}: {
  shots: Shot[];
  setShots: React.Dispatch<React.SetStateAction<Shot[]>>;
  note: string;
  setNote: (n: string) => void;
  onDone: () => void;
}) {
  const { back } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState<"starting" | "on" | "unavailable">("starting");
  const [flash, setFlash] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  // Live camera preview (needs https or localhost). Falls back to the phone's camera app.
  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera API");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
        setLive("on");
      } catch {
        if (!cancelled) setLive("unavailable");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const add = (files: FileList | null) => {
    if (!files) return;
    setShots((s) => [...s, ...[...files].slice(0, MAX - s.length).map(newShot)]);
  };

  const capture = () => {
    const v = video.current;
    if (!v || shots.length >= MAX) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    c.toBlob((b) => b && setShots((s) => [...s, newShot(b)]), "image/jpeg", 0.92);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[#0e0d0a] text-paper lg:mx-auto lg:max-w-lg lg:rounded-[28px]">
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      <input ref={nativeCamera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => add(e.target.files)} />

      <div className="flex items-center justify-between px-4 pt-[max(16px,env(safe-area-inset-top))]">
        <button onClick={back} aria-label="Close camera" className="grid size-11 place-items-center rounded-full bg-white/12">
          <X className="size-5" />
        </button>
        <div className="flex h-8 items-center rounded-full bg-white/12 px-3.5 text-[13px] font-semibold">
          {shots.length ? `Photo ${Math.min(shots.length + 1, MAX)} of ${MAX}` : "New listing"}
        </div>
        <button onClick={() => setNoteOpen(true)} aria-label="Add a note for the AI" className={cx("grid size-11 place-items-center rounded-full", note ? "bg-accent text-ink" : "bg-white/12")}>
          <PenLine className="size-5" />
        </button>
      </div>

      <div className="relative mx-4 mt-4 flex-1 overflow-hidden rounded-[28px] bg-[#3a352d]" style={{ minHeight: 380, maxHeight: 520 }}>
        <video ref={video} playsInline muted className={cx("absolute inset-0 size-full object-cover", live !== "on" && "hidden")} />
        {live === "unavailable" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            {shots.length > 0 ? (
              <img src={shots[shots.length - 1].url} alt="" className="absolute inset-0 size-full object-cover opacity-60" />
            ) : null}
            <button onClick={() => nativeCamera.current?.click()} className="relative grid size-24 place-items-center rounded-full bg-paper text-ink" aria-label="Take a photo">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
            </button>
            <div className="relative font-display text-xl font-extrabold">Take a photo</div>
          </div>
        )}
        {live === "on" && <div className="pointer-events-none absolute inset-[14%] rounded-[18px] border-2 border-accent" />}
        <AnimatePresence>{flash && <motion.div className="absolute inset-0 bg-white" initial={{ opacity: 0.8 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} />}</AnimatePresence>
        <div className="absolute inset-x-4 bottom-4 rounded-2xl bg-[#0e0d0a]/75 px-3.5 py-3 text-sm leading-snug backdrop-blur">
          {TIPS[Math.min(shots.length, TIPS.length - 1)]}
        </div>
      </div>

      <div className="flex min-h-[72px] gap-2 overflow-x-auto px-4 pt-4 no-scrollbar">
        <AnimatePresence>
          {shots.map((s, i) => (
            <motion.div
              key={s.id}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className={cx("relative size-14 shrink-0 overflow-hidden rounded-[14px]", i === 0 && "ring-2 ring-accent")}
            >
              <button onClick={() => setShots((all) => [s, ...all.filter((x) => x.id !== s.id)])} className="size-full" aria-label={i === 0 ? "Cover photo" : "Make this the cover photo"}>
                <img src={s.url} alt="" className="size-full object-cover" />
              </button>
              <button
                onClick={() => setShots((all) => all.filter((x) => x.id !== s.id))}
                className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/65"
                aria-label="Remove photo"
              >
                <X className="size-3" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {shots.length < MAX && <div className="size-14 shrink-0 rounded-[14px] border-[1.5px] border-dashed border-paper/35" />}
      </div>

      <div className="flex items-center justify-between px-7 pb-[max(28px,env(safe-area-inset-bottom))] pt-5">
        <button onClick={() => gallery.current?.click()} aria-label="Choose from gallery" className="grid size-[52px] place-items-center rounded-2xl bg-white/12">
          <ImagePlus className="size-[22px]" />
        </button>
        <button
          onClick={live === "on" ? capture : () => nativeCamera.current?.click()}
          aria-label="Take photo"
          disabled={shots.length >= MAX}
          className="size-[84px] rounded-full border-[5px] border-paper p-[5px] disabled:opacity-40"
        >
          <motion.span whileTap={{ scale: 0.85 }} className="block size-full rounded-full bg-paper" />
        </button>
        <button
          onClick={onDone}
          disabled={!shots.length}
          className="h-[52px] rounded-2xl bg-accent px-[18px] text-base font-bold text-ink disabled:opacity-40"
        >
          Done · {shots.length}
        </button>
      </div>

      <Sheet open={noteOpen} onClose={() => setNoteOpen(false)} title="Anything AI should know?" subtitle="Optional. Helps with price and honesty.">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          autoFocus
          aria-label="Note for the AI"
          placeholder="e.g. bought in 2022, battery 89%, small scratch on the back, original box included"
          className="w-full resize-none rounded-2xl border-[1.5px] border-line bg-card p-4 text-ink placeholder:text-faint focus:border-ink focus:outline-none"
        />
        <Button className="mt-3 w-full" onClick={() => setNoteOpen(false)}>
          Save note
        </Button>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- analyzing (design artboard 4)

type Stage = "looking" | "lens" | "searching" | "pricing" | "writing" | "polishing" | "done";
const ORDER: Stage[] = ["looking", "lens", "searching", "pricing", "writing", "polishing", "done"];

function Analyzing({
  shots,
  note,
  textOnly,
  onDescribe,
  onDone,
  onCancel,
}: {
  shots: Shot[];
  note: string;
  textOnly: boolean;
  onDescribe: (text: string) => void;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { health, settings } = useApp();
  const [stage, setStage] = useState<Stage>("looking");
  const [lens, setLens] = useState<{ matches: number; bestGuess?: string } | null>(null);
  const [prices, setPrices] = useState<{ value: number; currency: string }[]>([]);
  const [queries, setQueries] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsDescription, setNeedsDescription] = useState(false);
  const [description, setDescription] = useState("");
  const [preview, setPreview] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setPreview((p) => (p + 1) % shots.length), 2200);
    return () => clearInterval(t);
  }, [shots.length]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const files = await Promise.all(shots.map((s) => prepareForUpload(s.file)));
        let listing: Listing | null = null;
        for await (const e of api.analyze(files, note, textOnly)) {
          if (e.type === "stage" && e.stage !== "done") setStage(e.stage);
          else if (e.type === "lens") setLens({ matches: e.matches, bestGuess: e.bestGuess });
          else if (e.type === "price") setPrices((p) => [...p, { value: e.value, currency: e.currency }]);
          else if (e.type === "search") setQueries((q) => (q.includes(e.query) ? q : [...q, e.query].slice(-4)));
          else if (e.type === "listing") listing = e.listing;
          else if (e.type === "error") {
            if (e.code === "needs_description") {
              setNeedsDescription(true);
              return;
            }
            throw new Error(e.message);
          }
        }
        if (!listing?.analysis) throw new Error("Analysis didn't finish. Please try again.");
        // Comparables found by the AI also feed the price chart.
        setPrices((p) => [...p, ...listing!.analysis!.comparables.map((c) => ({ value: c.price, currency: c.currency }))]);
        setStage("polishing");
        try {
          const enhanced = await Promise.all(
            listing.photos.map((p, i) => enhancePhoto(`/photos/${listing!.id}/${p}`, "auto", listing!.analysis!.crops.find((c) => c.photo === i))),
          );
          await api.uploadEnhanced(listing.id, enhanced);
        } catch (err) {
          console.warn("photo polish failed", err);
        }
        setStage("done");
        setTimeout(() => onDone(listing!.id), 600);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [shots, note, textOnly, onDone]);

  const lensOn = Boolean(health?.lens.vision || health?.lens.serpapi) || (lens?.matches ?? 0) > 0;
  const steps = [
    { id: "looking" as const, label: "Identifying the item", done: lens?.bestGuess ? `Looks like ${lens.bestGuess}` : undefined },
    ...(lensOn ? [{ id: "lens" as const, label: "Google Lens visual search", done: lens ? `Google Lens: ${lens.matches} visual matches` : undefined }] : []),
    { id: "searching" as const, label: "Checking sold prices on eBay, Vinted and more", done: "Checked sold prices" },
    { id: "writing" as const, label: "Writing your listings", done: "Listings written" },
    { id: "polishing" as const, label: "Polishing your photos", done: "Photos polished" },
  ];
  const idx = ORDER.indexOf(stage);
  const stepState = (id: Stage) => {
    const i = ORDER.indexOf(id);
    // "pricing" happens between searching and writing; treat it as part of searching.
    const cur = stage === "pricing" ? ORDER.indexOf("searching") : idx;
    return i < cur || stage === "done" ? "done" : i === cur ? "active" : "todo";
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))]">
      <div className="relative h-[250px] overflow-hidden rounded-[28px] bg-soft">
        <AnimatePresence mode="popLayout">
          <motion.img
            key={preview}
            src={shots[preview]?.url}
            alt=""
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 size-full object-cover"
          />
        </AnimatePresence>
        {!error && stage !== "done" && (
          <motion.div
            className="scan-line absolute inset-x-0 h-[3px]"
            animate={{ top: ["8%", "92%"] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut", repeatType: "reverse" }}
          />
        )}
        {stage === "done" && (
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute inset-0 grid place-items-center bg-ink/30">
            <div className="grid size-20 place-items-center rounded-full bg-accent text-ink">
              <Check className="size-10" strokeWidth={3} />
            </div>
          </motion.div>
        )}
        {lens?.bestGuess && (
          <div className="absolute bottom-3.5 left-3.5 flex h-[30px] max-w-[85%] items-center truncate rounded-full bg-ink px-3 text-[13px] font-semibold capitalize text-paper">
            {lens.bestGuess}
          </div>
        )}
      </div>

      {needsDescription ? (
        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (description.trim()) onDescribe(description.trim());
          }}
        >
          <h1 className="font-display text-[26px] font-extrabold leading-tight">What is it?</h1>
          <p className="mt-2 text-muted">Claude can't see photos inside this app, so tell it in a few words. Your photos still go on the listing.</p>
          <label htmlFor="describe" className="sr-only">
            What is it?
          </label>
          <input
            id="describe"
            autoFocus
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Varta CR2032 battery, new in pack"
            className="mt-4 h-14 w-full rounded-2xl border-[1.5px] border-line bg-card px-4 text-ink placeholder:text-faint focus:border-ink focus:outline-none"
          />
          <Button type="submit" size="lg" className="mt-3 w-full" disabled={!description.trim()}>
            Price it and write the listing
          </Button>
          <p className="mt-3 text-center text-xs text-muted">Tip: on claude.ai in Safari, Claude can look at the photo itself.</p>
        </form>
      ) : error ? (
        <div className="mt-8 text-center">
          <h1 className="font-display text-2xl font-extrabold">Something went wrong</h1>
          <p className="mt-2 text-muted">{error}</p>
          <Button className="mt-6" onClick={onCancel}>
            Back to photos
          </Button>
        </div>
      ) : (
        <>
          <h1 className="mt-5 font-display text-[28px] font-extrabold">{stage === "done" ? "Ready to sell" : "Finding the best price"}</h1>
          <ol className="mt-3 space-y-1.5">
            {steps.map((s) => {
              const st = stepState(s.id);
              return (
                <li key={s.id} className={cx("flex min-h-10 items-center gap-3", st === "todo" && "text-faint")}>
                  <span
                    className={cx(
                      "grid size-8 shrink-0 place-items-center rounded-[10px]",
                      st === "done" && "bg-ok-soft text-ok",
                      st === "active" && "bg-accent text-ink",
                      st === "todo" && "bg-soft",
                    )}
                  >
                    {st === "done" ? <Check className="size-4" strokeWidth={3} /> : st === "active" ? <Loader2 className="size-4 animate-spin" /> : null}
                  </span>
                  <span className={cx("text-[15px]", st === "active" ? "font-bold" : "font-semibold")}>{st === "done" && s.done ? s.done : s.label}</span>
                </li>
              );
            })}
          </ol>
          {queries.length > 0 && stepState("searching") === "active" && (
            <div className="mt-2 truncate pl-11 text-[13px] text-muted">Searching: {queries[queries.length - 1]}</div>
          )}
          <PriceChart prices={prices} currency={settings.currency} />
        </>
      )}
    </div>
  );
}

/** Live histogram of prices found so far (Google Lens shop results + comparables). */
function PriceChart({ prices, currency }: { prices: { value: number; currency: string }[]; currency: string }) {
  const values = prices.map((p) => p.value).filter((v) => v > 0);
  if (values.length < 2) {
    return (
      <div className="mt-4 rounded-[20px] border border-line bg-card p-3.5">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Prices found so far</div>
        <div className="shimmer mt-3 h-14 rounded-lg" />
        <div className="mt-2 text-[13px] text-muted">Prices appear here as they're found.</div>
      </div>
    );
  }
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length / 2)];
  const bins = new Array(7).fill(0) as number[];
  for (const v of values) bins[Math.min(6, Math.floor(((v - lo) / Math.max(1, hi - lo)) * 7))]++;
  const peak = Math.max(...bins);
  const medianBin = Math.min(6, Math.floor(((median - lo) / Math.max(1, hi - lo)) * 7));
  const fmt = (v: number) => formatPrice(Math.round(v), currency);
  return (
    <div className="mt-4 rounded-[20px] border border-line bg-card p-3.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Prices found so far</span>
        <span className="text-[13px] text-muted">{values.length} listings</span>
      </div>
      <div className="mt-3 flex h-14 items-end gap-1.5" aria-hidden="true">
        {bins.map((n, i) => (
          <motion.div
            key={i}
            layout
            className={cx("flex-1 rounded", i === medianBin ? "bg-accent" : n ? "bg-accent-soft" : "bg-soft")}
            style={{ height: `${Math.max(14, (n / peak) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[13px] text-muted">
        <span>{fmt(lo)}</span>
        <span className="font-bold text-ink">most at ~{fmt(median)}</span>
        <span>{fmt(hi)}</span>
      </div>
    </div>
  );
}
