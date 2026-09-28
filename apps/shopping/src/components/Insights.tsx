"use client";

import { BadgePercent, Check, Minus, Plus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/format";
import { fetchCoupons, fetchVerdict, type VerdictResult } from "@/lib/insights-client";
import type { Coupon, VerdictInput } from "@/lib/prompts";
import { setAppState, useAppState } from "@/lib/store";
import { askAI } from "./Assistant";

const LOOK = {
  buy: { label: "Buy now", cls: "bg-ok text-white" },
  wait: { label: "Wait", cls: "bg-warn text-white" },
  skip: { label: "Skip it", cls: "bg-bad text-white" },
} as const;

/** "Should you buy it?" card on the product page. */
export function VerdictCard({ input, followUp }: { input: VerdictInput; followUp: string }) {
  const [v, setV] = useState<VerdictResult | null>(null);
  const key = JSON.stringify(input);
  useEffect(() => {
    let alive = true;
    setV(null);
    fetchVerdict(JSON.parse(key) as VerdictInput)
      .then((r) => alive && setV(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);

  return (
    <section className="card p-5" aria-live="polite">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <Sparkles size={14} className="text-accent" /> AI opinion · Should you buy it?
      </div>
      {!v ? (
        <div className="mt-3 space-y-2">
          <div className="shimmer h-8 w-32 rounded-lg" />
          <div className="shimmer h-3.5 w-3/4 rounded" />
          <div className="shimmer h-3.5 w-2/3 rounded" />
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className={cn("rounded-xl px-3.5 py-1.5 font-serif text-lg font-bold", LOOK[v.verdict].cls)}>{LOOK[v.verdict].label}</span>
            <span className="text-[15px] font-medium">{v.headline}</span>
          </div>
          <ul className="mt-3 space-y-2 text-[15px]">
            {v.reasons.map((r) => (
              <li key={r.text} className="flex gap-2.5">
                <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full", r.kind === "pro" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
                  {r.kind === "pro" ? <Plus size={12} strokeWidth={3} /> : <Minus size={12} strokeWidth={3} />}
                </span>
                {r.text}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span>{v.source === "claude" ? "By Claude" : "Based on prices and shop checks"}</span>
            <button onClick={() => askAI(followUp)} className="text-sm font-semibold text-accent-ink">
              Ask a follow-up
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Looks for coupon codes for the selected shop and lets the shopper attach one to the order. */
export function CouponRow({ offerId, store, domain, product }: { offerId: string; store: string; domain: string; product: string }) {
  const { pendingCoupon } = useAppState();
  const [coupons, setCoupons] = useState<Coupon[] | null | "loading">("loading");
  useEffect(() => {
    let alive = true;
    setCoupons("loading");
    fetchCoupons(store, domain, product)
      .then((c) => alive && setCoupons(c))
      .catch(() => alive && setCoupons(null));
    return () => {
      alive = false;
    };
  }, [store, domain, product]);

  if (coupons === null) return null;
  if (coupons === "loading")
    return (
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <BadgePercent size={14} className="animate-pulse text-ok" /> Looking for coupon codes…
      </div>
    );
  if (!coupons.length) return <div className="mb-2 text-xs text-muted">No coupon codes found for {store} right now.</div>;
  return (
    <div className="mb-2 space-y-1.5">
      {coupons.map((c) => {
        const on = pendingCoupon?.offerId === offerId && pendingCoupon.code === c.code;
        return (
          <div key={c.code} className="flex items-center gap-2 rounded-xl border border-dashed border-ok bg-ok-soft/50 px-3 py-2 text-sm">
            <BadgePercent size={16} className="shrink-0 text-ok" />
            <div className="min-w-0 flex-1">
              <b className="font-mono">{c.code}</b> <span className="text-muted">· {c.description}</span>
            </div>
            <button
              onClick={() => setAppState({ pendingCoupon: on ? null : { offerId, code: c.code, description: c.description } })}
              className={cn("btn h-8 px-3 text-xs", on ? "bg-ok text-white" : "btn-ghost")}
              aria-pressed={on}
            >
              {on ? (
                <>
                  <Check size={13} /> Added
                </>
              ) : (
                "Use"
              )}
            </button>
          </div>
        );
      })}
      <p className="text-xs text-muted">We try the code when ordering. You&apos;re charged less only if it works.</p>
    </div>
  );
}
