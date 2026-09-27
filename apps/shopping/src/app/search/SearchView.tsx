"use client";

import { Globe, Search, ShieldAlert, Sparkles, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { askAI } from "@/components/Assistant";
import { ProductCard } from "@/components/ProductCard";
import { getStore, offersFor, PRODUCTS, searchProducts, type Product } from "@/lib/data";
import { quoteDelivery } from "@/lib/delivery";
import { money } from "@/lib/format";
import { findPlace } from "@/lib/geo";
import { assessStore } from "@/lib/safety";
import { POPULAR } from "@/lib/search";
import { runSearch, type SearchSource } from "@/lib/search-client";
import { setAppState, useAppState } from "@/lib/store";


const STEPS = ["Searching shops", "Comparing prices", "Checking shops for scams", "Working out delivery"];

type State = { status: "idle" | "loading" | "done"; products: Product[]; source: SearchSource | null };

export function SearchView() {
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get("q") ?? "").trim();
  const [input, setInput] = useState(q);
  const [state, setState] = useState<State>({ status: "idle", products: [], source: null });
  const [step, setStep] = useState(0);
  const ctl = useRef<AbortController | null>(null);
  const { address } = useAppState();
  const city = findPlace(address.city)?.city ?? "Prague";

  useEffect(() => setInput(q), [q]);

  useEffect(() => {
    if (!q) return setState({ status: "idle", products: [], source: null });
    const c = new AbortController();
    ctl.current = c;
    setState({ status: "loading", products: [], source: null });
    setAppState((s) => ({ recent: [q, ...s.recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 6) }));
    runSearch(q, city, (p) => setState((s) => (s.products.some((x) => x.id === p.id) ? s : { ...s, products: [...s.products, p] })), c.signal)
      .then((source) => setState((s) => ({ status: "done", source, products: source === "sample" && !s.products.length ? catalogFor(q) : s.products })))
      .catch(() => setState((s) => ({ ...s, status: "done", source: s.source ?? "sample" })));
    return () => c.abort();
  }, [q, city]);

  useEffect(() => {
    if (state.status !== "loading") return;
    setStep(0);
    const t = setInterval(() => setStep((i) => (i + 1) % STEPS.length), 2200);
    return () => clearInterval(t);
  }, [state.status]);

  const go = (term: string) => router.push(`/search?q=${encodeURIComponent(term)}`);

  return (
    <div className="mx-auto max-w-5xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) go(input.trim());
        }}
        className="relative mt-2"
      >
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={19} />
        <input
          id="search"
          autoFocus={!q}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search anything: sneakers, a laptop, a sofa…"
          className="h-13 w-full rounded-full border border-line bg-surface py-3.5 pl-11 pr-28 text-[16px] outline-none focus:border-accent"
        />
        <button className="btn btn-primary absolute right-1.5 top-1.5 bottom-1.5 px-5 text-sm">Search</button>
      </form>

      {!q && <Browse onPick={go} />}

      {q && (
        <>
          <StatusBar state={state} step={step} city={city} onStop={() => ctl.current?.abort()} />
          <Verdict products={state.products} city={city} loading={state.status === "loading"} />

          <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {state.products.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
            {state.status === "loading" &&
              Array.from({ length: Math.max(2, 4 - state.products.length) }, (_, i) => (
                <div key={`s${i}`}>
                  <div className="shimmer aspect-square rounded-2xl" />
                  <div className="shimmer mt-3 h-4 w-3/4 rounded" />
                  <div className="shimmer mt-2 h-3.5 w-1/2 rounded" />
                </div>
              ))}
          </div>

          {state.status === "done" && !state.products.length && (
            <div className="py-16 text-center">
              <p className="text-muted">Nothing found for “{q}”.</p>
              <button onClick={() => askAI(`Help me find: ${q}`)} className="btn btn-accent mt-4 h-11 px-5">
                <Sparkles size={16} /> Ask the AI instead
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function catalogFor(q: string) {
  const hits = searchProducts(q);
  return hits.length ? hits : [];
}

function StatusBar({ state, step, city, onStop }: { state: State; step: number; city: string; onStop: () => void }) {
  if (state.status === "loading") {
    return (
      <div className="mt-5 flex items-center gap-3 rounded-2xl bg-accent-soft/60 px-4 py-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
        </span>
        <AnimatePresence mode="wait">
          <motion.span key={step} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="flex-1 text-sm font-medium text-accent-ink">
            {STEPS[step]}
            {step === 3 ? ` to ${city}` : ""}… {state.products.length > 0 && <span className="text-muted">· {state.products.length} found</span>}
          </motion.span>
        </AnimatePresence>
        <button onClick={onStop} className="btn btn-ghost h-8 px-3 text-xs">
          <Square size={11} fill="currentColor" /> Stop
        </button>
      </div>
    );
  }
  if (!state.source) return null;
  const label =
    state.source === "web"
      ? { icon: <Globe size={14} />, text: "Live prices from the web", cls: "bg-ok-soft text-ok" }
      : state.source === "estimate"
        ? { icon: <Sparkles size={14} />, text: "AI price estimates — confirm on the shop's site", cls: "bg-warn-soft text-warn" }
        : { icon: <Sparkles size={14} />, text: "Sample catalog — AI search isn't available here", cls: "bg-surface-2 text-muted" };
  return <div className={`mt-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${label.cls}`}>{label.icon}{label.text}</div>;
}

/** Free, instant summary computed from the results (no extra AI call). */
function Verdict({ products, city, loading }: { products: Product[]; city: string; loading: boolean }) {
  if (!products.length) return null;
  const to = findPlace(city) ?? findPlace("Prague")!;
  let best: { product: Product; store: string; total: number } | null = null;
  let shops = 0;
  let blocked = 0;
  for (const p of products) {
    for (const o of offersFor(p.id)) {
      const s = getStore(o.storeId);
      if (!s) continue;
      shops++;
      if (assessStore(s, o.price, p.typicalPrice).level === "danger") {
        blocked++;
        continue;
      }
      const total = o.price + Math.min(...quoteDelivery(s.warehouse, to).map((q) => q.price));
      if (!best || total < best.total) best = { product: p, store: s.name, total };
    }
  }
  return (
    <motion.div layout className="card mt-4 grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft">
          <Sparkles size={18} className="text-accent" />
        </span>
        <div className="text-[15px] leading-relaxed">
          {best ? (
            <>
              Cheapest safe option: <b>{best.product.brand} {best.product.title}</b> at <b>{best.store}</b>, {money(best.total)} delivered to {to.city}.
            </>
          ) : (
            "Every offer so far failed the safety check."
          )}
          <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-muted">
            <span>{shops} offers checked{loading ? " so far" : ""}</span>
            {blocked > 0 && (
              <span className="flex items-center gap-1 text-bad">
                <ShieldAlert size={13} /> {blocked} risky {blocked === 1 ? "shop" : "shops"} hidden
              </span>
            )}
          </div>
        </div>
      </div>
      {best && (
        <Link href={`/product/${best.product.id}`} className="btn btn-primary h-10 px-5 text-sm">
          View deal
        </Link>
      )}
    </motion.div>
  );
}

function Browse({ onPick }: { onPick: (t: string) => void }) {
  const { recent } = useAppState();
  return (
    <div className="mt-6">
      {recent.length > 0 && (
        <>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Recent</h2>
          <div className="mb-6 flex flex-wrap gap-2">
            {recent.map((r) => (
              <button key={r} onClick={() => onPick(r)} className="rounded-full bg-surface-2 px-3.5 py-1.5 text-sm hover:bg-line">
                {r}
              </button>
            ))}
          </div>
        </>
      )}
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Popular right now</h2>
      <div className="flex flex-wrap gap-2">
        {POPULAR.map((t) => (
          <button key={t} onClick={() => onPick(t)} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm hover:border-accent">
            {t}
          </button>
        ))}
      </div>
      <h2 className="mb-4 mt-10 font-serif text-2xl font-semibold">Editor’s picks</h2>
      <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
        {PRODUCTS.map((p, i) => (
          <ProductCard key={p.id} product={p} index={i} />
        ))}
      </div>
    </div>
  );
}
