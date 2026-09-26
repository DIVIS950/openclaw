import { Camera, Loader2, Settings as SettingsIcon, Sparkles, AlertTriangle } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { PLATFORMS, effectivePrice, type Listing } from "../../shared/types.ts";
import { useApp } from "../App.tsx";
import { PlatformLogo, Segmented, cx } from "../components/ui.tsx";
import { api, formatPrice, photoUrl } from "../lib/api.ts";

type Filter = "all" | "draft" | "live" | "sold";

export function Home() {
  const { go, settings, demo } = useApp();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    api.listings().then(setListings).catch(() => setListings([]));
  }, []);

  const currency = settings!.currency;
  const all = listings ?? [];
  const live = all.filter((l) => l.status === "live");
  const sold = all.filter((l) => l.status === "sold");
  const shown = filter === "all" ? all : all.filter((l) => l.status === filter);
  const value = live.reduce((s, l) => s + effectivePrice(l), 0);
  const earned = sold.reduce((s, l) => s + effectivePrice(l), 0);

  return (
    <div className="relative min-h-dvh pb-40">
      <div className="pointer-events-none absolute -top-32 right-[-120px] size-[360px] rounded-full ai-gradient opacity-20 blur-[100px]" />
      <header className="relative flex items-center justify-between px-5 pt-[max(20px,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="" className="size-9 rounded-xl" />
          <span className="text-xl font-extrabold tracking-tight">SnapSell</span>
        </div>
        <button onClick={() => go("/settings")} className="grid size-10 place-items-center rounded-full bg-white/5" aria-label="Settings">
          <SettingsIcon className="size-5" />
        </button>
      </header>

      {demo && (
        <div className="relative mx-5 mt-4 flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>Demo mode: add your Anthropic API key to <code className="font-mono">.env</code> to analyze real photos.</span>
        </div>
      )}

      <section className="relative mt-6 grid grid-cols-3 gap-2 px-5">
        {[
          { label: "Live value", value: formatPrice(value, currency) },
          { label: "Earned", value: formatPrice(earned, currency) },
          { label: "Listings", value: String(all.length) },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="card px-3 py-3.5"
          >
            <div className="truncate text-lg font-bold">{s.value}</div>
            <div className="text-xs text-ink-400">{s.label}</div>
          </motion.div>
        ))}
      </section>

      {all.length > 0 && (
        <div className="mt-6 px-5">
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { id: "all", label: "All" },
              { id: "draft", label: "Drafts" },
              { id: "live", label: "Live" },
              { id: "sold", label: "Sold" },
            ]}
          />
        </div>
      )}

      {listings === null ? (
        <div className="mt-6 grid grid-cols-2 gap-3 px-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card aspect-[4/5] shimmer" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState onStart={() => go("/new")} />
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 px-5">
          {shown.map((l, i) => (
            <ListingCard key={l.id} listing={l} index={i} onOpen={() => go(`/l/${l.id}`)} />
          ))}
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg bg-gradient-to-t from-ink-950 via-ink-950/90 to-transparent px-5 pt-12 safe-bottom">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => go("/new")}
          className="pointer-events-auto flex h-16 w-full items-center justify-center gap-3 rounded-[22px] ai-gradient glow text-lg font-bold"
        >
          <Camera className="size-6" /> Sell something
        </motion.button>
      </div>
    </div>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-14 flex flex-col items-center px-10 text-center">
      <button onClick={onStart} className="relative grid size-32 place-items-center rounded-[36px] bg-white/[0.04] ai-border">
        <Camera className="size-12 text-white/80" />
        <motion.div
          className="absolute -right-2 -top-2 grid size-10 place-items-center rounded-2xl ai-gradient"
          animate={{ rotate: [0, 12, -8, 0] }}
          transition={{ repeat: Infinity, duration: 3 }}
        >
          <Sparkles className="size-5" />
        </motion.div>
      </button>
      <h2 className="mt-8 text-2xl font-bold">Turn stuff into money</h2>
      <p className="mt-2 text-ink-400">
        Take a photo of anything you want to sell. AI identifies it, prices it from real market data and writes the perfect listing.
      </p>
    </motion.div>
  );
}

function ListingCard({ listing: l, index, onOpen }: { listing: Listing; index: number; onOpen: () => void }) {
  const title = l.edits.title ?? l.analysis?.title ?? (l.status === "failed" ? "Analysis failed" : "Analyzing…");
  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04 }}
      whileTap={{ scale: 0.97 }}
      onClick={onOpen}
      className="card overflow-hidden text-left"
    >
      <div className="relative aspect-square bg-ink-800">
        {l.photos[0] && <img src={photoUrl(l, 0)} alt="" className="size-full object-cover" loading="lazy" />}
        <span
          className={cx(
            "absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold backdrop-blur-md",
            l.status === "live" && "bg-emerald-500/80",
            l.status === "draft" && "bg-black/50",
            l.status === "sold" && "bg-white text-ink-950",
            l.status === "failed" && "bg-red-500/80",
            l.status === "analyzing" && "bg-black/50",
          )}
        >
          {l.status === "analyzing" ? <Loader2 className="inline size-3 animate-spin" /> : l.status}
        </span>
      </div>
      <div className="p-3">
        <div className="line-clamp-2 text-sm font-medium leading-snug">{title}</div>
        <div className="mt-2 flex items-center justify-between">
          <span className="font-bold">{l.analysis ? formatPrice(effectivePrice(l), l.analysis.price.currency) : "—"}</span>
          <div className="flex -space-x-1.5">
            {PLATFORMS.filter((p) => l.publish[p]?.status === "live").map((p) => (
              <div key={p} className="rounded-[7px] ring-2 ring-ink-900">
                <PlatformLogo platform={p} size={20} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.button>
  );
}
