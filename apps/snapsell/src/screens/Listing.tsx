import {
  Check,
  Copy,
  ExternalLink,
  Flame,
  Info,
  Lightbulb,
  Loader2,
  MoreHorizontal,
  Send,
  Sparkles,
  Tag,
  Trash2,
  Wand2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  CONDITIONS,
  CONDITION_LABEL,
  CONDITION_SHORT,
  PLATFORMS,
  PLATFORM_META,
  effectiveCondition,
  effectiveCopy,
  effectivePrice,
  type Listing,
  type Platform,
} from "../../shared/types.ts";
import { useApp } from "../App.tsx";
import { PublishSheet } from "../components/PublishSheet.tsx";
import { Button, Label, PlatformLogo, Segmented, Sheet, TopBar, cx } from "../components/ui.tsx";
import { api, formatPrice, photoUrl } from "../lib/api.ts";
import { PRESETS, enhancePhoto, type Preset } from "../lib/image.ts";

const TITLE_LIMIT: Record<Platform, number> = { ebay: 80, facebook: 100, vinted: 60 };

export function ListingScreen({ id }: { id: string }) {
  const { back, go } = useApp();
  const [listing, setListing] = useState<Listing | null>(null);
  const [menu, setMenu] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const current = useRef<Listing | null>(null);
  current.current = listing;

  useEffect(() => {
    let alive = true;
    const load = () => api.listing(id).then((l) => alive && setListing(l)).catch(() => go("/", true));
    void load();
    // Keep polling while analysis runs or a marketplace is being posted to.
    const t = setInterval(() => {
      const cur = current.current;
      const busy = cur?.status === "analyzing" || Object.values(cur?.publish ?? {}).some((p) => p?.status === "working");
      if (busy) void load();
    }, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, go]);

  /** Optimistic local edit + debounced save. */
  const edit = (fn: (e: Listing["edits"]) => Listing["edits"]) => {
    setListing((l) => {
      if (!l) return l;
      const edits = fn(l.edits);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void api.update(l.id, { edits }), 500);
      return { ...l, edits };
    });
  };

  if (!listing) {
    return (
      <div>
        <TopBar onBack={back} />
        <div className="mx-5 aspect-square rounded-[32px] shimmer bg-white/5" />
      </div>
    );
  }

  const a = listing.analysis;
  if (!a) {
    return (
      <div>
        <TopBar onBack={back} title="Listing" />
        <div className="px-5 pt-10 text-center">
          {listing.status === "failed" ? (
            <>
              <div className="text-xl font-bold">Analysis failed</div>
              <p className="mt-2 text-ink-400">{listing.error}</p>
              <div className="mt-6 flex justify-center gap-2">
                <Button onClick={() => go("/new", true)}>Try again</Button>
                <Button variant="danger" onClick={() => api.remove(listing.id).then(() => go("/", true))}>
                  Delete
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center gap-2 text-ink-400">
              <Loader2 className="size-5 animate-spin" /> Still analyzing…
            </div>
          )}
        </div>
      </div>
    );
  }

  const currency = a.price.currency;
  const price = effectivePrice(listing);
  const liveCount = PLATFORMS.filter((p) => listing.publish[p]?.status === "live").length;

  return (
    <div className="pb-36">
      <TopBar
        onBack={back}
        title={<span className="text-ink-400 text-sm font-medium">{listing.status === "live" ? "Live listing" : "Draft"}</span>}
        right={
          <button onClick={() => setMenu(true)} className="grid size-10 place-items-center rounded-full hover:bg-white/5" aria-label="More">
            <MoreHorizontal className="size-5" />
          </button>
        }
      />

      <PhotoStudio listing={listing} onChange={setListing} />

      <div className="space-y-4 px-5">
        {/* Identity */}
        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="pt-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-pink-300">
            <Sparkles className="size-3.5" /> {a.item.category}
          </div>
          <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight tracking-tight">{a.item.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-400">
            {[a.item.brand, a.item.model, a.item.color, a.item.size, a.item.era].filter(Boolean).map((x) => (
              <span key={x} className="rounded-full bg-white/5 px-2.5 py-1">
                {x}
              </span>
            ))}
            <Confidence value={a.confidence} />
          </div>
          {a.identificationNotes && <p className="mt-2 text-sm text-ink-500">{a.identificationNotes}</p>}
        </motion.section>

        <PriceCard listing={listing} price={price} onPrice={(v) => edit((e) => ({ ...e, price: v }))} />

        {/* Condition */}
        <section className="card p-4">
          <Label>Condition</Label>
          <Segmented
            value={effectiveCondition(listing)}
            onChange={(v) => edit((e) => ({ ...e, condition: v }))}
            options={CONDITIONS.map((c) => ({ id: c, label: CONDITION_SHORT[c] }))}
          />
          <p className="mt-3 px-1 text-sm text-ink-400">
            <span className="font-semibold text-white">{CONDITION_LABEL[effectiveCondition(listing)]}.</span> {a.conditionNotes}
          </p>
        </section>

        <CopyEditor listing={listing} onEdit={edit} />

        {/* Specifics */}
        <section className="card p-4">
          <Label>Item specifics</Label>
          <div className="grid grid-cols-2 gap-2">
            {a.attributes.map((at) => (
              <div key={at.name} className="rounded-2xl bg-white/[0.04] px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wider text-ink-500">{at.name}</div>
                <div className="truncate text-sm font-medium">{at.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {a.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs text-ink-200">
                <Tag className="size-3" /> {t}
              </span>
            ))}
          </div>
          <div className="mt-3 px-1 text-xs text-ink-500">
            Est. shipping: ~{a.shipping.weightKg} kg, {a.shipping.packageSize} package
          </div>
        </section>

        {a.photoTips.length > 0 && (
          <section className="rounded-3xl border border-amber-300/10 bg-amber-300/[0.04] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
              <Lightbulb className="size-4" /> Photo tips to sell faster
            </div>
            <ul className="mt-2 space-y-1 text-sm text-ink-400">
              {a.photoTips.map((t) => (
                <li key={t}>• {t}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg bg-gradient-to-t from-ink-950 via-ink-950/95 to-transparent px-5 pt-10 safe-bottom">
        <Button variant="ai" size="lg" className="w-full" onClick={() => setPublishing(true)}>
          <Send className="size-5" />
          {liveCount ? `Live on ${liveCount} · Manage` : `Sell for ${formatPrice(price, currency)}`}
        </Button>
      </div>

      <PublishSheet open={publishing} onClose={() => setPublishing(false)} listing={listing} onChange={setListing} />

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <div className="space-y-2">
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={async () => {
              setListing(await api.update(listing.id, { status: listing.status === "sold" ? "draft" : "sold" }));
              setMenu(false);
            }}
          >
            <Check className="size-5" /> {listing.status === "sold" ? "Mark as not sold" : "Mark as sold"}
          </Button>
          <Button
            variant="danger"
            className="w-full justify-start"
            onClick={async () => {
              if (!confirm("Delete this listing from SnapSell? Listings already posted on marketplaces stay there.")) return;
              await api.remove(listing.id);
              go("/", true);
            }}
          >
            <Trash2 className="size-5" /> Delete listing
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color = pct >= 80 ? "text-emerald-400" : pct >= 55 ? "text-amber-300" : "text-red-400";
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1", color)}>
      <svg viewBox="0 0 20 20" className="size-4 -rotate-90">
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${(pct / 100) * 50.3} 50.3`} strokeLinecap="round" />
      </svg>
      {pct}% match
    </span>
  );
}

function PhotoStudio({ listing, onChange }: { listing: Listing; onChange: (l: Listing) => void }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [studio, setStudio] = useState(false);
  const [busy, setBusy] = useState<Preset | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const hasEnhanced = listing.enhanced.length > 0;

  const apply = async (preset: Preset) => {
    setBusy(preset);
    setError(null);
    try {
      const blobs = await Promise.all(
        listing.photos.map((p, i) => enhancePhoto(`/photos/${listing.id}/${p}`, preset, listing.analysis?.crops.find((c) => c.photo === i))),
      );
      onChange(await api.uploadEnhanced(listing.id, blobs));
      setShowOriginal(false);
      setStudio(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative">
      <div
        ref={scroller}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="flex snap-x snap-mandatory overflow-x-auto no-scrollbar"
      >
        {listing.photos.map((_, i) => (
          <div key={i} className="w-full shrink-0 snap-center px-5">
            <div className="relative aspect-square overflow-hidden rounded-[32px] bg-ink-800">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.img
                  key={`${showOriginal}-${listing.enhanced[i] ?? ""}`}
                  src={photoUrl(listing, i, !showOriginal)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 size-full object-cover"
                  alt=""
                />
              </AnimatePresence>
            </div>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-5 top-3 flex justify-between px-3">
        {hasEnhanced ? (
          <button
            className="pointer-events-auto rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold backdrop-blur-md"
            onPointerDown={() => setShowOriginal(true)}
            onPointerUp={() => setShowOriginal(false)}
            onPointerLeave={() => setShowOriginal(false)}
          >
            {showOriginal ? "Original" : "✨ Enhanced · hold to compare"}
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={() => setStudio(true)}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-ink-950"
        >
          <Wand2 className="size-3.5" /> Studio
        </button>
      </div>
      {listing.photos.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {listing.photos.map((_, i) => (
            <div key={i} className={cx("h-1.5 rounded-full transition-all", i === index ? "w-5 bg-white" : "w-1.5 bg-white/25")} />
          ))}
        </div>
      )}

      <Sheet open={studio} onClose={() => !busy && setStudio(false)} title="Photo studio">
        <p className="-mt-2 mb-4 text-sm text-ink-400">AI crops to your item, fixes light and color and makes every photo marketplace-ready.</p>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              disabled={!!busy}
              onClick={() => apply(p.id)}
              className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left disabled:opacity-60"
            >
              <div
                className={cx(
                  "mb-3 aspect-square rounded-xl",
                  p.id === "auto" && "bg-gradient-to-br from-stone-500 to-stone-800",
                  p.id === "vivid" && "bg-gradient-to-br from-orange-400 via-pink-500 to-violet-600",
                  p.id === "studio" && "bg-gradient-to-b from-white to-zinc-200",
                )}
              />
              <div className="text-sm font-semibold">{p.label}</div>
              <div className="text-[11px] leading-tight text-ink-400">{p.hint}</div>
              {busy === p.id && (
                <div className="absolute inset-0 grid place-items-center bg-black/60">
                  <Loader2 className="size-6 animate-spin" />
                </div>
              )}
            </button>
          ))}
        </div>
        {busy === "studio" && (
          <p className="mt-3 text-xs text-ink-400">First run downloads the cut-out AI model to your phone (~40 MB). After that it's fast and private.</p>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </Sheet>
    </div>
  );
}

function PriceCard({ listing, price, onPrice }: { listing: Listing; price: number; onPrice: (v: number) => void }) {
  const p = listing.analysis!.price;
  const comps = listing.analysis!.comparables;
  const [showComps, setShowComps] = useState(false);
  const min = Math.min(p.low, p.quickSale, price) * 0.9;
  const max = Math.max(p.high, price) * 1.1;
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;

  return (
    <section className="card relative overflow-hidden p-4">
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full ai-gradient opacity-15 blur-3xl" />
      <div className="relative flex items-start justify-between">
        <Label>Your price</Label>
        <span
          className={cx(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
            p.demand === "high" ? "bg-emerald-500/15 text-emerald-400" : p.demand === "medium" ? "bg-amber-400/15 text-amber-300" : "bg-white/10 text-ink-400",
          )}
        >
          <Flame className="size-3.5" /> {p.demand} demand
        </span>
      </div>
      <div className="relative flex items-baseline gap-2 px-1">
        <input
          inputMode="decimal"
          value={price}
          onChange={(e) => {
            const v = Number(e.target.value.replace(",", "."));
            if (!Number.isNaN(v)) onPrice(v);
          }}
          style={{ width: `${Math.max(2, String(price).length) + 0.5}ch` }}
          className="bg-transparent text-[44px] font-extrabold tracking-tight focus:outline-none"
          aria-label="Price"
        />
        <span className="text-xl font-bold text-ink-400">{p.currency}</span>
      </div>

      {/* Market range */}
      <div className="relative mt-4 px-1">
        <div className="relative h-2 rounded-full bg-white/10">
          <div className="absolute inset-y-0 rounded-full ai-gradient opacity-70" style={{ left: pos(p.low), right: `calc(100% - ${pos(p.high)})` }} />
          <motion.div
            className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-ink-900 bg-white shadow-lg"
            animate={{ left: pos(price) }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-ink-400">
          <span>{formatPrice(p.low, p.currency)}</span>
          <span>market range</span>
          <span>{formatPrice(p.high, p.currency)}</span>
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-3 gap-2">
        {[
          { label: "Quick sale", value: p.quickSale },
          { label: "Suggested", value: p.suggested },
          { label: "Top price", value: p.high },
        ].map((o) => (
          <button
            key={o.label}
            onClick={() => onPrice(o.value)}
            className={cx(
              "rounded-2xl border px-2 py-2.5 text-center transition-colors",
              price === o.value ? "border-pink-400/60 bg-pink-400/10" : "border-white/5 bg-white/[0.03]",
            )}
          >
            <div className="font-bold">{formatPrice(o.value, p.currency)}</div>
            <div className="text-[11px] text-ink-400">{o.label}</div>
          </button>
        ))}
      </div>

      <p className="relative mt-4 flex gap-2 px-1 text-sm text-ink-400">
        <Info className="mt-0.5 size-4 shrink-0" /> {p.reasoning}
      </p>

      {comps.length > 0 && (
        <div className="relative mt-3">
          <button onClick={() => setShowComps((s) => !s)} className="px-1 text-sm font-semibold text-pink-300">
            {showComps ? "Hide" : "See"} {comps.length} comparable listings
          </button>
          <AnimatePresence>
            {showComps && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-2 divide-y divide-white/5">
                  {comps.map((c, i) => (
                    <a
                      key={i}
                      href={c.url ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 px-1 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{c.title}</div>
                        <div className="text-xs text-ink-500">
                          {c.source} · {c.sold ? <span className="text-emerald-400">sold</span> : "asking"}
                        </div>
                      </div>
                      <div className="font-semibold">{formatPrice(c.price, c.currency)}</div>
                      {c.url && <ExternalLink className="size-3.5 text-ink-500" />}
                    </a>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

function CopyEditor({ listing, onEdit }: { listing: Listing; onEdit: (fn: (e: Listing["edits"]) => Listing["edits"]) => void }) {
  const [tab, setTab] = useState<Platform>("ebay");
  const [copied, setCopied] = useState(false);
  const copy = effectiveCopy(listing, tab);
  const limit = TITLE_LIMIT[tab];

  const set = (field: "title" | "description", value: string) =>
    onEdit((e) => ({ ...e, platforms: { ...e.platforms, [tab]: { ...e.platforms?.[tab], [field]: value } } }));

  return (
    <section className="card p-4">
      <Label
        right={
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(`${copy.title}\n\n${copy.description}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex items-center gap-1 normal-case tracking-normal text-pink-300"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
        }
      >
        AI-written listing
      </Label>
      <div className="mb-3 flex gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p}
            onClick={() => setTab(p)}
            className={cx(
              "flex flex-1 items-center justify-center gap-2 rounded-2xl border py-2 text-sm font-semibold transition-colors",
              tab === p ? "border-white/20 bg-white/10" : "border-transparent bg-white/[0.03] text-ink-400",
            )}
          >
            <PlatformLogo platform={p} size={20} />
            <span className="hidden min-[400px]:inline">{PLATFORM_META[p].name.split(" ")[0]}</span>
          </button>
        ))}
      </div>
      <div className="relative">
        <input
          value={copy.title}
          onChange={(e) => set("title", e.target.value)}
          className="w-full rounded-2xl border border-white/5 bg-white/[0.04] px-4 py-3 pr-14 font-semibold focus:border-pink-400/50 focus:outline-none"
          aria-label="Title"
        />
        <span className={cx("absolute right-3 top-1/2 -translate-y-1/2 text-xs", copy.title.length > limit ? "text-red-400" : "text-ink-500")}>
          {copy.title.length}/{limit}
        </span>
      </div>
      <textarea
        value={copy.description}
        onChange={(e) => set("description", e.target.value)}
        rows={9}
        className="mt-2 w-full resize-y rounded-2xl border border-white/5 bg-white/[0.04] p-4 text-[15px] leading-relaxed focus:border-pink-400/50 focus:outline-none"
        aria-label="Description"
      />
    </section>
  );
}
