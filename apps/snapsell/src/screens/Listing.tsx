import { Check, ChevronRight, ChevronsLeftRight, Copy, ExternalLink, Lightbulb, Loader2, Mic, MoreHorizontal, Trash2, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  CONDITIONS,
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
import { GeminiApp } from "../components/GeminiApp.tsx";
import { CONDITION_FACTOR, conditionRatio, effectiveSize, nicePrice } from "../../shared/pricing.ts";
import { SizeCard } from "../components/SizeCard.tsx";
import { CountUp } from "../components/CountUp.tsx";
import { PublishSheet } from "../components/PublishSheet.tsx";
import { VoiceAssistant } from "../components/VoiceAssistant.tsx";
import { Button, Card, Label, Pill, PlatformLogo, PriceTag, Segmented, Sheet, TopBar, cx } from "../components/ui.tsx";
import { api, copyText, formatPrice, photoResolver, photoUrl } from "../lib/api.ts";
import type { PhotoPlan } from "../../shared/photoPlan.ts";
import { PRESETS, enhancePhoto, type Preset } from "../lib/image.ts";

const TITLE_LIMIT: Record<Platform, number> = { ebay: 80, facebook: 100, vinted: 60 };

export function ListingScreen({ id }: { id: string }) {
  const { back, go } = useApp();
  const [listing, setListing] = useState<Listing | null>(null);
  const [menu, setMenu] = useState(false);
  const [voice, setVoice] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      const busy =
        cur?.status === "analyzing" || Object.values(cur?.publish ?? {}).some((p) => p?.status === "working" || p?.status === "queued");
      if (busy) void load();
    }, 2000);
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
        <div className="shimmer mx-4 h-[300px] rounded-[28px]" />
      </div>
    );
  }

  const a = listing.analysis;
  if (!a) {
    return (
      <div>
        <TopBar onBack={back} />
        <div className="px-5 pt-10 text-center">
          {listing.status === "failed" ? (
            <>
              <h1 className="font-display text-2xl font-extrabold">Analysis failed</h1>
              <p className="mt-2 text-muted">{listing.error}</p>
              <div className="mt-6 flex justify-center gap-2">
                <Button onClick={() => go("/new", true)}>Try again</Button>
                <Button variant="danger" onClick={() => api.remove(listing.id).then(() => go("/", true))}>
                  Delete
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center gap-2 text-muted">
              <Loader2 className="size-5 animate-spin" /> Still analyzing…
            </div>
          )}
        </div>
      </div>
    );
  }

  const price = effectivePrice(listing);
  const liveCount = PLATFORMS.filter((p) => listing.publish[p]?.status === "live").length;
  const statusText = { live: "Live", sold: "Sold", draft: "Draft · saved", analyzing: "Analyzing", failed: "Failed" }[listing.status];

  return (
    <div className="pb-36 lg:pb-12">
      <TopBar
        onBack={back}
        title={<span className="block text-center text-sm font-semibold text-muted lg:text-left">{statusText}</span>}
        right={
          <button onClick={() => setMenu(true)} className="grid size-11 place-items-center rounded-full hover:bg-soft" aria-label="More options">
            <MoreHorizontal className="size-5" />
          </button>
        }
      />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6 lg:px-8">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Photos listing={listing} onChange={setListing} />
        </div>

        <div className="rise space-y-3 px-4 lg:px-0">
          {/* Identity */}
          <div className="px-1 pt-4 lg:pt-0">
            <div className="text-xs font-bold uppercase tracking-[0.08em] text-accent-ink">{a.item.category}</div>
            <h1 className="mt-1 font-display text-[26px] font-extrabold leading-[1.08]">{a.item.name}</h1>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {[a.item.brand, a.item.color, effectiveSize(listing), a.item.era].filter(Boolean).map((x) => (
                <Pill key={x}>{x}</Pill>
              ))}
              <Pill tone={a.confidence >= 0.75 ? "ok" : "soft"}>{Math.round(Math.min(1, Math.max(0, a.confidence)) * 100)}% match</Pill>
            </div>
          </div>

          <SizeCard listing={listing} onEdit={edit} />

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setVoice(true)}
            className="flex w-full items-center gap-3 rounded-3xl bg-ink p-3.5 text-left text-paper"
          >
            <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-accent text-ink">
              <motion.span
                className="absolute inset-0 rounded-full bg-accent"
                animate={{ scale: [1, 1.5], opacity: [0.55, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 1.2 }}
              />
              <Mic className="relative size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[17px] font-extrabold">Asistent</span>
              <span className="block truncate text-[13px] text-[#b9b2a2]">Řekněte česky, co změnit nebo na co se zeptat</span>
            </span>
            <ChevronRight className="size-5 text-[#b9b2a2]" />
          </motion.button>

          <PriceCard listing={listing} price={price} onPrice={(v) => edit((e) => ({ ...e, price: v }))} />

          <Card>
            <Label>Condition</Label>
            <Segmented
              label="Condition"
              value={effectiveCondition(listing)}
              onChange={(v) =>
                edit((e) => {
                  const was = e.condition ?? a.condition;
                  // A price the seller set moves by the same step as the condition (worse shape, lower price).
                  const price = e.price !== undefined ? nicePrice((e.price * CONDITION_FACTOR[v]) / CONDITION_FACTOR[was]) : undefined;
                  return { ...e, condition: v, ...(price !== undefined ? { price } : {}) };
                })
              }
              options={CONDITIONS.map((c) => ({ id: c, label: CONDITION_SHORT[c] }))}
            />
            <p className="mt-2.5 text-sm leading-relaxed text-muted">AI noticed: {a.conditionNotes}</p>
            {effectiveCondition(listing) !== a.condition && (
              <p className="mt-1.5 text-sm font-semibold text-accent-ink">
                Price adjusted for {CONDITION_SHORT[effectiveCondition(listing)].toLowerCase()} condition
              </p>
            )}
          </Card>

          <CopyEditor listing={listing} onEdit={edit} />

          <Card>
            <Label>Item specifics</Label>
            <div className="grid grid-cols-2 gap-2">
              {a.attributes.map((at) => (
                <div key={at.name} className="min-w-0 rounded-xl bg-[#faf8f3] px-2.5 py-2">
                  <div className="text-[11px] text-muted">{at.name}</div>
                  <div className="truncate text-sm font-semibold">{at.value}</div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 text-xs text-muted">
              Shipping estimate: about {a.shipping.weightKg} kg, {a.shipping.packageSize} parcel
            </div>
          </Card>

          {a.photoTips.length > 0 && (
            <Card className="bg-[#fdf6e7]">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Lightbulb className="size-4 text-accent-ink" /> Photo tips to sell faster
              </div>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {a.photoTips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </Card>
          )}

          <div className="hidden lg:block">
            <Button size="lg" className="w-full" onClick={() => setPublishing(true)}>
              {liveCount ? `Live on ${liveCount} · Manage` : "Sell on 3 marketplaces"}
            </Button>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg bg-gradient-to-b from-paper/0 via-paper/90 to-paper px-4 pt-8 safe-bottom lg:hidden">
        <Button size="lg" className="w-full" onClick={() => setPublishing(true)}>
          {liveCount ? `Live on ${liveCount} · Manage` : "Sell on 3 marketplaces"}
        </Button>
      </div>

      <PublishSheet open={publishing} onClose={() => setPublishing(false)} listing={listing} onChange={setListing} />
      <VoiceAssistant open={voice} onClose={() => setVoice(false)} listing={listing} onChange={setListing} />

      <Sheet
        open={menu}
        onClose={() => {
          setMenu(false);
          setConfirmDelete(false);
        }}
      >
        <div className="space-y-2">
          <Button
            variant="soft"
            className="w-full justify-start"
            onClick={async () => {
              setListing(await api.update(listing.id, { status: listing.status === "sold" ? "draft" : "sold" }));
              setMenu(false);
            }}
          >
            <Check className="size-5" /> {listing.status === "sold" ? "Mark as not sold" : "Mark as sold"}
          </Button>
          {confirmDelete ? (
            <div className="rounded-2xl bg-bad-soft p-3.5">
              <p className="text-sm text-bad">Delete this listing from SnapSell? Anything already posted on marketplaces stays there.</p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="ink"
                  size="sm"
                  className="bg-bad hover:bg-bad"
                  onClick={async () => {
                    await api.remove(listing.id);
                    go("/", true);
                  }}
                >
                  Delete
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" className="w-full justify-start" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-5" /> Delete listing
            </Button>
          )}
        </div>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- photos + studio (artboards 5 & 7)

function Photos({ listing, onChange }: { listing: Listing; onChange: (l: Listing) => void }) {
  const [original, setOriginal] = useState(false);
  const [studio, setStudio] = useState(false);
  const [index, setIndex] = useState(0);
  const hasEnhanced = listing.enhanced.length > 0;

  return (
    <div className="relative px-4 lg:px-0">
      <div
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-[28px] border border-line bg-card no-scrollbar"
      >
        {listing.photos.map((_, i) => (
          <div key={i} className="relative aspect-square w-full shrink-0 snap-center">
            <img src={photoUrl(listing, i, !original)} alt={`Photo ${i + 1}`} className="absolute inset-0 size-full object-cover" />
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-7 top-3 flex items-start justify-between lg:inset-x-3">
        {hasEnhanced ? (
          <div className="pointer-events-auto flex rounded-full bg-soft/95 p-[3px] backdrop-blur" role="radiogroup" aria-label="Photo version">
            {[
              [false, "Enhanced"],
              [true, "Original"],
            ].map(([val, label]) => (
              <button
                key={String(label)}
                role="radio"
                aria-checked={original === val}
                onClick={() => setOriginal(val as boolean)}
                className={cx("h-[30px] rounded-full px-3 text-[13px] font-semibold", original === val && "bg-ink text-white")}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <button onClick={() => setStudio(true)} className="pointer-events-auto flex h-9 items-center gap-1.5 rounded-full bg-accent px-3 text-[13px] font-bold text-ink">
          <Wand2 className="size-3.5" /> Studio
        </button>
      </div>
      {listing.photos.length > 1 && (
        <div className="mt-3 flex justify-center gap-[5px]" aria-hidden="true">
          {listing.photos.map((_, i) => (
            <div key={i} className={cx("h-1.5 rounded-full transition-all", i === index ? "w-[18px] bg-ink" : "w-1.5 bg-line-strong")} />
          ))}
        </div>
      )}
      <Studio open={studio} onClose={() => setStudio(false)} listing={listing} onChange={onChange} />
    </div>
  );
}

function Studio({ open, onClose, listing, onChange }: { open: boolean; onClose: () => void; listing: Listing; onChange: (l: Listing) => void }) {
  const [preset, setPreset] = useState<Preset>("auto");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [split, setSplit] = useState(50);
  const [error, setError] = useState<string | null>(null);
  // AI Magic: the AI's edit for each photo, asked once per photo and reused for preview and apply.
  const plans = useRef(new Map<number, Promise<PhotoPlan>>());
  const [reason, setReason] = useState<string | null>(null);
  const crop = (i: number) => listing.analysis?.crops.find((c) => c.photo === i);
  const original = photoResolver.resolve(`/photos/${listing.id}/${listing.photos[0]}`);
  const planFor = (i: number) => {
    if (!plans.current.has(i)) {
      const p = api.photoPlan(listing.id, i);
      p.catch(() => plans.current.delete(i));
      plans.current.set(i, p);
    }
    return plans.current.get(i)!;
  };

  const choose = async (p: Preset) => {
    setPreset(p);
    setBusy("preview");
    setError(null);
    setReason(null);
    try {
      const plan = p === "magic" ? await planFor(0) : undefined;
      if (plan?.reason) setReason(plan.reason);
      const blob = await enhancePhoto(original, p, crop(0), plan);
      setPreview(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (open && !preview) void choose("auto");
    // Only generate the first preview when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const apply = async () => {
    setBusy("apply");
    setError(null);
    try {
      const blobs = await Promise.all(
        listing.photos.map(async (p, i) => enhancePhoto(`/photos/${listing.id}/${p}`, preset, crop(i), preset === "magic" ? await planFor(i) : undefined)),
      );
      onChange(await api.uploadEnhanced(listing.id, blobs));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const n = listing.photos.length;
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Photo studio" subtitle={`Drag to compare. Changes apply to all ${n} photo${n > 1 ? "s" : ""}.`}>
      <div className="relative aspect-square overflow-hidden rounded-3xl bg-soft">
        <img src={original} alt="Before" className="absolute inset-0 size-full object-cover" />
        {preview && (
          <img src={preview} alt="After" className="absolute inset-0 size-full object-cover" style={{ clipPath: `inset(0 0 0 ${split}%)` }} />
        )}
        {busy === "preview" && (
          <div className="absolute inset-0 grid place-items-center bg-paper/50">
            <Loader2 className="size-8 animate-spin" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-y-0 w-[3px] -translate-x-1/2 bg-accent" style={{ left: `${split}%` }}>
          <div className="absolute left-1/2 top-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-accent text-ink">
            <ChevronsLeftRight className="size-5" />
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          aria-label="Compare before and after"
          className="absolute inset-0 size-full cursor-ew-resize opacity-0"
        />
        <span className="absolute left-3 top-3 rounded-full bg-[#0e0d0a]/70 px-2.5 py-1 text-xs font-bold text-white">Before</span>
        <span className="absolute right-3 top-3 rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white">After</span>
      </div>

      <div className="mt-3.5 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Style">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={preset === p.id}
            disabled={!!busy}
            onClick={() => choose(p.id)}
            className={cx("rounded-2xl bg-card p-2 text-left", preset === p.id ? "border-2 border-ink" : "border-[1.5px] border-line")}
          >
            <span
              className={cx(
                "grid h-[58px] place-items-center rounded-[10px]",
                p.id === "magic" && "bg-ink text-accent",
                p.id === "auto" && "bg-[#b9a68e]",
                p.id === "vivid" && "bg-[#d98a4b]",
                p.id === "studio" && "border border-line bg-white",
              )}
            >
              {p.id === "magic" && <Wand2 className="size-6" />}
            </span>
            <span className="mt-1.5 block truncate text-sm font-bold">{p.label}</span>
            <span className="block text-xs text-muted">{p.hint}</span>
          </button>
        ))}
      </div>
      {preset === "magic" && busy === "preview" && <p className="mt-3 text-xs text-muted">The AI is looking at your photo…</p>}
      {preset === "magic" && reason && !busy && (
        <p className="mt-3 flex gap-2 rounded-2xl bg-ink px-3.5 py-2.5 text-sm text-paper">
          <Wand2 className="mt-0.5 size-4 shrink-0 text-accent" />
          {reason}
        </p>
      )}
      {preset === "studio" && busy && <p className="mt-3 text-xs text-muted">The first White photo can take a few seconds. It all runs on this device, free and private.</p>}
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <Button size="lg" className="mt-4 w-full" onClick={apply} loading={busy === "apply"} disabled={!!busy}>
        Apply to {n} photo{n > 1 ? "s" : ""}
      </Button>
      <GeminiApp listing={listing} onChange={onChange} disabled={!!busy} />
    </Sheet>
  );
}

// ---------------------------------------------------------------- price (artboard 5)

function PriceCard({ listing, price, onPrice }: { listing: Listing; price: number; onPrice: (v: number) => void }) {
  // The AI priced its own reading of the condition; the range follows the seller's condition.
  const raw = listing.analysis!.price;
  const r = conditionRatio(listing);
  const p = { ...raw, low: nicePrice(raw.low * r), high: nicePrice(raw.high * r), suggested: nicePrice(raw.suggested * r), quickSale: nicePrice(raw.quickSale * r) };
  const comps = listing.analysis!.comparables;
  const [showComps, setShowComps] = useState(false);
  const [editing, setEditing] = useState(false);
  const min = Math.min(p.low, p.quickSale, price) * 0.92;
  const max = Math.max(p.high, price) * 1.08;
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  const demand = { high: "High demand", medium: "Steady demand", low: "Low demand" }[p.demand];

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Your price</span>
        <Pill tone={p.demand === "high" ? "ok" : "soft"} className="h-[26px] text-xs">
          {demand}
        </Pill>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {editing ? (
          <input
            autoFocus
            inputMode="decimal"
            defaultValue={price}
            aria-label="Price"
            onBlur={(e) => {
              const v = Number(e.target.value.replace(",", ".").replace(/\s/g, ""));
              if (v > 0) onPrice(v);
              setEditing(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="h-[54px] w-40 rounded-[14px] border-2 border-ink bg-card px-3 font-display text-[28px] font-extrabold focus:outline-none"
          />
        ) : (
          <button onClick={() => setEditing(true)} aria-label={`Price ${formatPrice(price, p.currency)}, tap to edit`}>
            <PriceTag size="lg">
              <CountUp value={price} format={(v) => formatPrice(v, p.currency)} />
            </PriceTag>
          </button>
        )}
        <span className="text-[13px] leading-snug text-muted">
          Tap the tag
          <br />
          to change it
        </span>
      </div>

      <div className="relative mt-4 h-2 rounded bg-soft" aria-hidden="true">
        <div className="absolute inset-y-0 rounded bg-accent-soft" style={{ left: pos(p.low), right: `calc(100% - ${pos(p.high)})` }} />
        <motion.div
          className="absolute -top-1.5 size-5 -translate-x-1/2 rounded-full border-[3px] border-white bg-ink"
          animate={{ left: pos(price) }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>{formatPrice(p.low, p.currency)}</span>
        <span>market range</span>
        <span>{formatPrice(p.high, p.currency)}</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: "Quick sale", value: p.quickSale },
          { label: "Suggested", value: p.suggested },
          { label: "Top price", value: p.high },
        ].map((o) => (
          <button
            key={o.label}
            onClick={() => onPrice(o.value)}
            aria-pressed={price === o.value}
            className={cx("h-[54px] rounded-[14px] bg-card text-[15px] font-bold leading-tight", price === o.value ? "border-2 border-ink" : "border-[1.5px] border-line")}
          >
            {formatPrice(o.value, p.currency)}
            <span className="block text-[11px] font-medium text-muted">{o.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">{p.reasoning}</p>

      {comps.length > 0 && (
        <>
          <button onClick={() => setShowComps((s) => !s)} aria-expanded={showComps} className="mt-2 text-sm font-bold underline decoration-line-strong underline-offset-4">
            {showComps ? "Hide" : "See"} the {comps.length} listings behind this price
          </button>
          <AnimatePresence initial={false}>
            {showComps && (
              <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                {comps.map((c, i) => (
                  <li key={i} className="border-b border-soft last:border-0">
                    <a href={c.url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{c.title}</span>
                        <span className="block text-xs text-muted">
                          {c.source} · {c.sold ? <span className="font-semibold text-ok">sold</span> : "asking"}
                        </span>
                      </span>
                      <span className="font-bold">{formatPrice(c.price, c.currency)}</span>
                      {c.url && <ExternalLink className="size-3.5 text-muted" />}
                    </a>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- copy (artboard 6)

function CopyEditor({ listing, onEdit }: { listing: Listing; onEdit: (fn: (e: Listing["edits"]) => Listing["edits"]) => void }) {
  const [tab, setTab] = useState<Platform>("ebay");
  const [copied, setCopied] = useState(false);
  const copy = effectiveCopy(listing, tab);
  const limit = TITLE_LIMIT[tab];

  const set = (field: "title" | "description", value: string) =>
    onEdit((e) => ({ ...e, platforms: { ...e.platforms, [tab]: { ...e.platforms?.[tab], [field]: value } } }));

  return (
    <Card>
      <Label
        right={
          <button
            onClick={async () => {
              if (!(await copyText(`${copy.title}\n\n${copy.description}`))) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex h-8 items-center gap-1.5 rounded-full bg-soft px-3 text-[13px] font-semibold"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
        }
      >
        Written for each site
      </Label>
      <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="Marketplace">
        {PLATFORMS.map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={tab === p}
            onClick={() => setTab(p)}
            className={cx("flex h-11 items-center justify-center gap-2 rounded-xl bg-card text-sm font-semibold", tab === p ? "border-2 border-ink" : "border-[1.5px] border-line")}
          >
            <PlatformLogo platform={p} size={20} />
            {p === "ebay" ? "eBay" : PLATFORM_META[p].name.split(" ")[0]}
          </button>
        ))}
      </div>
      <label className="mt-3.5 flex justify-between text-[13px] font-semibold text-muted" htmlFor="copy-title">
        Title <span className={cx("font-medium", copy.title.length > limit && "text-bad")}>{copy.title.length} / {limit}</span>
      </label>
      <input
        id="copy-title"
        value={copy.title}
        onChange={(e) => set("title", e.target.value)}
        className="mt-1.5 h-12 w-full rounded-xl border-[1.5px] border-line bg-[#faf8f3] px-3 text-[15px] font-semibold focus:border-ink focus:outline-none"
      />
      <label className="mt-3 block text-[13px] font-semibold text-muted" htmlFor="copy-desc">
        Description
      </label>
      <textarea
        id="copy-desc"
        value={copy.description}
        onChange={(e) => set("description", e.target.value)}
        rows={9}
        className="mt-1.5 w-full resize-y rounded-xl border-[1.5px] border-line bg-[#faf8f3] p-3 text-sm leading-relaxed focus:border-ink focus:outline-none"
      />
    </Card>
  );
}
