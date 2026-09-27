"use client";

import { AlertTriangle, Check, ChevronDown, MapPin, Plane, Sparkles, Truck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { askAI } from "@/components/Assistant";
import { PriceRange } from "@/components/PriceRange";
import { SaveButton } from "@/components/SaveButton";
import { ProductArt, ScoreRing, TrustBadge } from "@/components/ui";
import { getProduct, getStaticProduct, getStore, offersFor, type Product } from "@/lib/data";
import { quoteDelivery, type DeliverySpeed } from "@/lib/delivery";
import { arrivalWindow, cn, daysRange, money } from "@/lib/format";
import { findPlace, PLACES } from "@/lib/geo";
import { assessStore } from "@/lib/safety";
import { setAppState, useAppState } from "@/lib/store";

export function ProductView({ productId }: { productId: string }) {
  // Built-in products render on the server; search results exist only in the browser.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const product = mounted ? getProduct(productId) : getStaticProduct(productId);
  if (!product) {
    return mounted ? (
      <div className="py-24 text-center">
        <p className="text-muted">This product isn't saved on this device any more.</p>
        <Link href="/search" className="btn btn-primary mt-4 px-5 py-2">
          Search again
        </Link>
      </div>
    ) : (
      <div className="shimmer mt-4 aspect-[4/3] rounded-2xl" />
    );
  }
  return <ProductDetail product={product} />;
}

function ProductDetail({ product }: { product: Product }) {
  const { address } = useAppState();
  const to = findPlace(address.city) ?? findPlace("Prague")!;

  const rows = useMemo(
    () =>
      offersFor(product.id)
        .map((offer) => {
          const store = getStore(offer.storeId)!;
          const safety = assessStore(store, offer.price, product.typicalPrice);
          const quotes = quoteDelivery(store.warehouse, to);
          return { offer, store, safety, quotes, cheapestTotal: offer.price + Math.min(...quotes.map((q) => q.price)) };
        })
        // Safe shops first, then by total price including cheapest delivery.
        .sort((a, b) => Number(a.safety.level === "danger") - Number(b.safety.level === "danger") || a.cheapestTotal - b.cheapestTotal),
    [product, to],
  );

  const [selected, setSelected] = useState(rows[0].offer.id);
  const [speed, setSpeed] = useState<DeliverySpeed>("standard");
  const [expanded, setExpanded] = useState<string | null>(null);
  const current = rows.find((r) => r.offer.id === selected)!;
  const quote = current.quotes.find((q) => q.speed === speed) ?? current.quotes[0];
  const total = current.offer.price + quote.price;
  const scams = rows.filter((r) => r.safety.level === "danger");
  const saving = Math.max(...rows.filter((r) => r.safety.level !== "danger").map((r) => r.cheapestTotal)) - rows[0].cheapestTotal;

  return (
    <div className="grid gap-8 pb-24 lg:grid-cols-[1fr_1.1fr]">
      <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <ProductArt product={product} big className="aspect-[4/3.4] w-full" />
        <div className="mt-5">
          <div className="text-sm font-medium text-muted">{product.brand}</div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-serif text-3xl font-semibold tracking-tight md:text-4xl">{product.title}</h1>
            <SaveButton productId={product.id} />
          </div>
          <p className="mt-2 text-muted">{product.blurb}</p>
          {product.source === "estimate" && <p className="mt-2 text-xs text-warn">Prices are AI estimates. Check the shop's site before you buy.</p>}
          {product.source === "web" && <p className="mt-2 text-xs text-ok">Live prices found on the web just now.</p>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {product.specs.map((s) => (
              <span key={s} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <div className="card flex items-start gap-3 border-accent/30 bg-accent-soft/40 p-4">
          <Sparkles className="mt-0.5 shrink-0 text-accent" size={20} />
          <div className="text-[15px] leading-relaxed">
            {rows[0].safety.level === "danger" ? (
              <>None of these shops passed the safety check. Don&apos;t buy this here.</>
            ) : (
              <>
                <b>{rows[0].store.name}</b> is the best safe deal: {money(rows[0].cheapestTotal)} delivered to {to.city}
                {saving > 1 && <>, saving you {money(saving)}</>}.
              </>
            )}
            {scams.length > 0 && (
              <>
                {" "}
                Watch out: <b className="text-bad">{scams.map((s) => s.store.name).join(", ")}</b> looks like a scam.
              </>
            )}
            <button onClick={() => askAI(`Compare offers for ${product.brand} ${product.title}`)} className="mt-1 block text-sm font-semibold text-accent-ink">
              Ask a follow-up →
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <h2 className="font-serif text-xl font-semibold">{rows.length} shops compared</h2>
          <label className="flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-2.5 pr-1 text-sm">
            <MapPin size={14} className="text-accent" />
            <select
              value={to.city}
              onChange={(e) => setAppState((s) => ({ address: { ...s.address, city: e.target.value } }))}
              className="bg-transparent pr-1 font-medium outline-none"
              aria-label="Deliver to"
            >
              {PLACES.map((p) => (
                <option key={p.city}>{p.city}</option>
              ))}
            </select>
          </label>
        </div>

        <PriceRange
          points={rows.filter((r) => r.safety.level !== "danger").map((r) => ({ id: r.offer.id, store: r.store.name, total: r.offer.price + (r.offer.id === selected ? quote.price : Math.min(...r.quotes.map((q) => q.price))) }))}
          selected={selected}
          onSelect={setSelected}
          hiddenRisky={scams.length}
        />

        <div className="mt-3 space-y-2.5">
          {rows.map((r, i) => {
            const isSel = r.offer.id === selected;
            const danger = r.safety.level === "danger";
            return (
              <motion.div
                key={r.offer.id}
                layout
                initial={{ y: 8 }}
                animate={{ y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={cn("card overflow-hidden transition", isSel && "ring-2 ring-accent", danger && "border-bad/40 bg-bad-soft/30")}
              >
                <button
                  onClick={() => (danger ? setExpanded(expanded === r.offer.id ? null : r.offer.id) : setSelected(r.offer.id))}
                  className="flex w-full items-center gap-3 p-3.5 text-left"
                >
                  <ScoreRing score={r.safety.score} level={r.safety.level} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{r.store.name}</span>
                      {i === 0 && !danger && <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-bg">Best</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <TrustBadge level={r.safety.level} />
                      <span className="truncate">{r.store.domain}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn("font-semibold", danger && "text-muted line-through")}>{money(r.offer.price)}</div>
                    <div className="text-xs text-muted">from {r.store.warehouse.city}</div>
                  </div>
                  {danger && <ChevronDown size={16} className={cn("text-muted transition", expanded === r.offer.id && "rotate-180")} />}
                </button>

                <AnimatePresence initial={false}>
                  {(danger ? expanded === r.offer.id : isSel) && (
                    <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="border-t border-line px-3.5 pb-3.5 pt-3">
                        {danger ? (
                          <div className="text-sm">
                            <div className="flex items-center gap-1.5 font-semibold text-bad">
                              <AlertTriangle size={15} /> Why we blocked this shop
                            </div>
                            <ul className="mt-1.5 space-y-1 text-muted">
                              {r.safety.flags.map((f) => (
                                <li key={f}>• {f}</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <>
                            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                              {r.safety.checks.map((c) => (
                                <span key={c.label} className="flex items-center gap-1">
                                  <Check size={12} className={c.ok ? "text-ok" : "text-warn"} />
                                  {c.label}
                                </span>
                              ))}
                            </div>
                            {r.offer.url && (
                              <a href={r.offer.url} target="_blank" rel="noopener noreferrer nofollow" className="mb-2 inline-block text-xs font-semibold text-accent-ink underline underline-offset-2">
                                Open on {r.store.domain} ↗
                              </a>
                            )}
                            <div className="grid gap-2 sm:grid-cols-2">
                              {r.quotes.map((q) => (
                                <button
                                  key={q.speed}
                                  onClick={() => setSpeed(q.speed)}
                                  className={cn("rounded-2xl border p-3 text-left transition", q.speed === quote.speed ? "border-accent bg-accent-soft/50" : "border-line hover:border-muted")}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                                      {q.mode === "air" ? <Plane size={14} /> : <Truck size={14} />}
                                      {q.label}
                                    </span>
                                    <span className="text-sm font-semibold">{money(q.price)}</span>
                                  </div>
                                  <div className="mt-0.5 text-xs text-muted">
                                    {daysRange(q.minDays, q.maxDays)} · {arrivalWindow(q.minDays, q.maxDays)}
                                  </div>
                                  <div className="text-xs text-muted">{q.carrier}</div>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-bg/90 backdrop-blur-xl md:bottom-0">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-muted">
              {current.store.name} · {quote.label} · {arrivalWindow(quote.minDays, quote.maxDays)}
            </div>
            <div className="text-lg font-semibold">{money(total)}</div>
          </div>
          <Link href={`/checkout?offer=${encodeURIComponent(current.offer.id)}&speed=${quote.speed}`} className="btn btn-primary h-12 px-7">
            Buy now
          </Link>
          <div className="hidden w-32 md:block" aria-hidden />
        </div>
      </div>
    </div>
  );
}
