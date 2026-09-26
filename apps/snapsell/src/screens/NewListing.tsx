import { Camera, Check, Globe, ImagePlus, Loader2, Search, Sparkles, Wand2, X, ScanEye, PenLine, TrendingUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Listing } from "../../shared/types.ts";
import { useApp } from "../App.tsx";
import { Button, TopBar, cx } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { enhancePhoto, prepareForUpload } from "../lib/image.ts";

type Stage = "looking" | "searching" | "pricing" | "writing" | "polishing" | "done";

const STAGES: { id: Stage; label: string; icon: typeof Search }[] = [
  { id: "looking", label: "Identifying the item", icon: ScanEye },
  { id: "searching", label: "Researching the market", icon: Globe },
  { id: "pricing", label: "Calculating the best price", icon: TrendingUp },
  { id: "writing", label: "Writing your listings", icon: PenLine },
  { id: "polishing", label: "Polishing your photos", icon: Wand2 },
];

type Shot = { id: string; file: Blob; url: string };

export function NewListing() {
  const { go, back } = useApp();
  const [shots, setShots] = useState<Shot[]>([]);
  const [note, setNote] = useState("");
  const [running, setRunning] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const add = (files: FileList | null) => {
    if (!files) return;
    const next = [...files].slice(0, 12 - shots.length).map((file) => ({
      id: Math.random().toString(36).slice(2),
      file,
      url: URL.createObjectURL(file),
    }));
    setShots((s) => [...s, ...next]);
  };

  // Open the camera straight away: that's why you tapped "Sell something".
  useEffect(() => {
    if (!matchMedia("(pointer: coarse)").matches) return; // phones only
    const t = setTimeout(() => cameraRef.current?.click(), 250);
    return () => clearTimeout(t);
  }, []);

  if (running) return <Analyzing shots={shots} note={note} onDone={(id) => go(`/l/${id}`, true)} onCancel={() => setRunning(false)} />;

  return (
    <div className="min-h-dvh pb-36">
      <TopBar title="New listing" onBack={back} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => add(e.target.files)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />

      <div className="px-5">
        {shots.length === 0 ? (
          <motion.button
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={() => cameraRef.current?.click()}
            className="relative mt-2 flex aspect-[4/5] w-full flex-col items-center justify-center overflow-hidden rounded-[32px] bg-white/[0.03] ai-border"
          >
            <div className="pointer-events-none absolute inset-0 opacity-40 ai-gradient blur-[90px] scale-50" />
            <div className="relative grid size-24 place-items-center rounded-full bg-white text-ink-950 shadow-2xl">
              <Camera className="size-10" />
            </div>
            <div className="relative mt-6 text-xl font-bold">Take a photo</div>
            <div className="relative mt-1 text-sm text-ink-400">Fill the frame, good light helps</div>
          </motion.button>
        ) : (
          <div>
            <div className="relative mt-2 aspect-[4/5] overflow-hidden rounded-[32px] bg-ink-800">
              <img src={shots[0].url} alt="" className="size-full object-cover" />
              <div className="absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-xs font-semibold backdrop-blur-md">
                Cover photo
              </div>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              <AnimatePresence>
                {shots.map((s, i) => (
                  <motion.div
                    key={s.id}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className={cx("relative size-20 shrink-0 overflow-hidden rounded-2xl", i === 0 && "ring-2 ring-pink-400")}
                  >
                    <button onClick={() => setShots((all) => [s, ...all.filter((x) => x.id !== s.id)])} className="size-full">
                      <img src={s.url} alt="" className="size-full object-cover" />
                    </button>
                    <button
                      onClick={() => setShots((all) => all.filter((x) => x.id !== s.id))}
                      className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 backdrop-blur"
                      aria-label="Remove photo"
                    >
                      <X className="size-3.5" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
              {shots.length < 12 && (
                <button
                  onClick={() => cameraRef.current?.click()}
                  className="grid size-20 shrink-0 place-items-center rounded-2xl border border-dashed border-white/15 text-ink-400"
                  aria-label="Add another photo"
                >
                  <Camera className="size-6" />
                </button>
              )}
            </div>
            <p className="mt-2 px-1 text-xs text-ink-500">Tip: add the back, labels, serial numbers and any flaws. Tap a photo to make it the cover.</p>
          </div>
        )}

        <button
          onClick={() => galleryRef.current?.click()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-white/5 py-3.5 text-sm font-semibold"
        >
          <ImagePlus className="size-5" /> Choose from gallery
        </button>

        <div className="mt-6">
          <div className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wider text-ink-400">Anything AI should know? (optional)</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="e.g. bought in 2022, battery 89%, small scratch on the back, original box included"
            className="w-full resize-none rounded-2xl border border-white/5 bg-white/[0.04] p-4 placeholder:text-ink-500 focus:border-pink-400/50 focus:outline-none"
          />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg bg-gradient-to-t from-ink-950 via-ink-950/95 to-transparent px-5 pt-10 safe-bottom">
        <Button variant="ai" size="lg" className="w-full" disabled={!shots.length} onClick={() => setRunning(true)}>
          <Sparkles className="size-5" /> Analyze with AI
        </Button>
      </div>
    </div>
  );
}

function Analyzing({
  shots,
  note,
  onDone,
  onCancel,
}: {
  shots: Shot[];
  note: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>("looking");
  const [queries, setQueries] = useState<string[]>([]);
  const [sources, setSources] = useState<{ title: string; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
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
        for await (const e of api.analyze(files, note)) {
          if (e.type === "stage" && e.stage !== "done") setStage(e.stage);
          else if (e.type === "search") setQueries((q) => (q.includes(e.query) ? q : [...q, e.query]));
          else if (e.type === "source") setSources((s) => (s.some((x) => x.url === e.url) ? s : [...s, e]).slice(-6));
          else if (e.type === "listing") listing = e.listing;
          else if (e.type === "error") throw new Error(e.message);
        }
        if (!listing?.analysis) throw new Error("Analysis didn't finish. Please try again.");
        setStage("polishing");
        try {
          const enhanced = await Promise.all(
            listing.photos.map((p, i) =>
              enhancePhoto(`/photos/${listing!.id}/${p}`, "auto", listing!.analysis!.crops.find((c) => c.photo === i)),
            ),
          );
          await api.uploadEnhanced(listing.id, enhanced);
        } catch (err) {
          console.warn("photo polish failed", err);
        }
        setStage("done");
        setTimeout(() => onDone(listing!.id), 500);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [shots, note, onDone]);

  const idx = STAGES.findIndex((s) => s.id === stage);
  return (
    <div className="relative min-h-dvh overflow-hidden px-5 pb-10 pt-[max(24px,env(safe-area-inset-top))]">
      <div className="pointer-events-none absolute -top-20 left-1/2 size-[420px] -translate-x-1/2 rounded-full ai-gradient opacity-25 blur-[110px]" />

      <div className="relative mx-auto mt-4 aspect-square w-full max-w-[340px] overflow-hidden rounded-[36px] ai-border">
        <AnimatePresence mode="popLayout">
          <motion.img
            key={preview}
            src={shots[preview]?.url}
            initial={{ opacity: 0, scale: 1.08 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 size-full object-cover"
          />
        </AnimatePresence>
        {!error && stage !== "done" && (
          <>
            <motion.div
              className="scan-line absolute inset-x-0 h-24"
              animate={{ top: ["-20%", "100%"] }}
              transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut", repeatType: "reverse" }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(transparent_55%,#09090bcc)]" />
            {/* Corner brackets like a viewfinder */}
            {["left-4 top-4 border-l-2 border-t-2", "right-4 top-4 border-r-2 border-t-2", "left-4 bottom-4 border-l-2 border-b-2", "right-4 bottom-4 border-r-2 border-b-2"].map((c) => (
              <div key={c} className={cx("absolute size-8 rounded-md border-white/80", c)} />
            ))}
          </>
        )}
        {stage === "done" && (
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute inset-0 grid place-items-center bg-black/40">
            <div className="grid size-20 place-items-center rounded-full ai-gradient">
              <Check className="size-10" />
            </div>
          </motion.div>
        )}
      </div>

      {error ? (
        <div className="relative mt-8 text-center">
          <div className="text-xl font-bold">Something went wrong</div>
          <p className="mt-2 text-ink-400">{error}</p>
          <Button className="mt-6" onClick={onCancel}>
            Back to photos
          </Button>
        </div>
      ) : (
        <>
          <div className="relative mt-8 space-y-1">
            {STAGES.map((s, i) => {
              const state = i < idx || stage === "done" ? "done" : i === idx ? "active" : "todo";
              return (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: state === "todo" ? 0.35 : 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 rounded-2xl px-3 py-2.5"
                >
                  <div
                    className={cx(
                      "grid size-9 place-items-center rounded-xl",
                      state === "done" ? "bg-emerald-500/15 text-emerald-400" : state === "active" ? "ai-gradient" : "bg-white/5",
                    )}
                  >
                    {state === "done" ? <Check className="size-4" /> : state === "active" ? <Loader2 className="size-4 animate-spin" /> : <s.icon className="size-4" />}
                  </div>
                  <span className={cx("font-medium", state === "active" && "ai-text font-semibold")}>{s.label}</span>
                </motion.div>
              );
            })}
          </div>

          <div className="relative mt-4 flex flex-wrap gap-2">
            <AnimatePresence>
              {queries.map((q) => (
                <motion.span
                  key={q}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-ink-200"
                >
                  <Search className="size-3" /> {q}
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
          {sources.length > 0 && (
            <div className="relative mt-3 space-y-1">
              {sources.map((s) => (
                <motion.div key={s.url} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="truncate text-xs text-ink-500">
                  ↳ {s.title}
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
