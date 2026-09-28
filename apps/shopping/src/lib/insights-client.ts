"use client";

import { getSample } from "./claude-page";
import { cleanVerdict, heuristicVerdict, verdictPrompt, type Coupon, type Verdict, type VerdictInput } from "./prompts";

export type VerdictResult = Verdict & { source: "claude" | "rules" };

/** AI "should you buy it?" for a product. Server (live web) or, in the web preview, Claude via the page. */
export async function fetchVerdict(input: VerdictInput): Promise<VerdictResult> {
  if (process.env.NEXT_PUBLIC_ORBIT_STATIC === "1") {
    const sample = await getSample();
    if (sample) {
      try {
        const { text } = await sample(verdictPrompt(input, false), { cache: { gcTime: 6 * 3600_000 } });
        const { extractJson } = await import("./prompts");
        const v = cleanVerdict(extractJson(text));
        if (v) return { ...v, source: "claude" };
      } catch {
        // fall through to rules
      }
    }
    return { ...heuristicVerdict(input), source: "rules" };
  }
  const res = await fetch("/api/ai/verdict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!res.ok) return { ...heuristicVerdict(input), source: "rules" };
  return (await res.json()) as VerdictResult;
}

/** Published coupon codes for a shop (full app only; needs live web search). */
export async function fetchCoupons(store: string, domain: string, product: string): Promise<Coupon[] | null> {
  if (process.env.NEXT_PUBLIC_ORBIT_STATIC === "1") return null;
  const res = await fetch("/api/coupons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store, domain, product }) });
  if (!res.ok) return null;
  const data = (await res.json()) as { coupons: Coupon[]; source: string };
  return data.source === "claude" ? data.coupons : null;
}
