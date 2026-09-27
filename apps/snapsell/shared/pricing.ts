import type { Analysis, Condition, Listing } from "./types.ts";

/**
 * How much an item is worth in each condition, relative to new. Used to move the price when the
 * seller's condition differs from what the AI priced (worse shape, lower price).
 */
export const CONDITION_FACTOR: Record<Condition, number> = {
  new: 1,
  like_new: 0.85,
  good: 0.7,
  fair: 0.52,
  poor: 0.3,
};

/** Prices people actually type: 45, 380, 1 250, 3 900 rather than 3 873. */
export function nicePrice(v: number) {
  if (v <= 0) return 0;
  const step = v < 100 ? 5 : v < 1000 ? 10 : v < 10000 ? 50 : 100;
  return Math.max(step, Math.round(v / step) * step);
}

/** Multiplier from the AI's priced condition to the listing's current condition. */
export function conditionRatio(l: Listing) {
  const ai = l.analysis?.condition ?? "good";
  const now = l.edits.condition ?? ai;
  return CONDITION_FACTOR[now] / CONDITION_FACTOR[ai];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};

/**
 * Checks the AI's price against the real listings it found. With 3+ comparables in the same
 * currency (sold ones preferred), a suggestion far from the market middle is pulled towards it,
 * and the range is widened to cover where the market really is.
 */
export function calibratePrice(a: Analysis): Analysis {
  const cur = a.price.currency.toUpperCase();
  const all = a.comparables.filter((c) => c.price > 0 && c.currency.toUpperCase() === cur);
  const sold = all.filter((c) => c.sold);
  const pool = (sold.length >= 3 ? sold : all).map((c) => c.price);
  const p = { ...a.price };
  if (pool.length >= 3) {
    // Drop wild outliers (a new-in-box listing among used ones, a typo) before taking the middle.
    const m0 = median(pool);
    const kept = pool.filter((v) => v > m0 * 0.4 && v < m0 * 2.5);
    const m = median(kept.length >= 3 ? kept : pool);
    const lo = quantile(kept.length >= 3 ? kept : pool, 0.25);
    const hi = quantile(kept.length >= 3 ? kept : pool, 0.75);
    if (p.suggested < m * 0.7 || p.suggested > m * 1.4) {
      // Real sold prices are the best evidence we have; asking prices get less weight.
      const w = sold.length >= 3 ? 0.65 : 0.5;
      p.suggested = p.suggested * (1 - w) + m * w;
      p.reasoning = `${p.reasoning} Adjusted towards the middle of ${kept.length} real ${sold.length >= 3 ? "sold" : ""} listings (about ${Math.round(m)} ${cur}).`.replace("  ", " ");
    }
    p.low = Math.min(p.low, lo, p.suggested * 0.9);
    p.high = Math.max(p.high, hi, p.suggested * 1.1);
  }
  p.low = Math.min(p.low, p.suggested);
  p.high = Math.max(p.high, p.suggested);
  p.quickSale = Math.min(p.quickSale > 0 ? p.quickSale : p.suggested * 0.85, p.suggested * 0.92);
  for (const k of ["low", "high", "suggested", "quickSale"] as const) p[k] = nicePrice(p[k]);
  return { ...a, price: p };
}

/** After analysis: the seller's own condition wins, then the price is checked against the market. */
export function finalizeAnalysis(a: Analysis, sellerCondition?: Condition | null): Analysis {
  return calibratePrice(sellerCondition ? { ...a, condition: sellerCondition } : a);
}

// ---------------------------------------------------------------- sizes

const SHOES = /shoe|sneaker|boot|trainer|sandal|heel|loafer|slipper|bot[ay]|tenisk|obuv|lodičk|pantof|sandál|kozačk|Schuh|chaussure|scarpe|zapat/i;
const CLOTHES =
  /cloth|shirt|t-shirt|tee|top|dress|jacket|coat|hoodie|sweat|jumper|sweater|jeans|trouser|pants|shorts|skirt|blouse|suit|legging|bra|swim|vest|cardigan|uniform|oblečen|triko|tričko|košil|šat|bund|kabát|mikin|svetr|kalhot|rifle|džín|sukn|halenk|oblek|plavk|vest|Kleid|Jacke|Hose|veste|pull|robe|pantalon/i;

export type SizeKind = "shoes" | "clothes" | null;

/** Whether this item has a size buyers filter by (Vinted requires it for clothes and shoes). */
export function sizeKind(a: Analysis | undefined): SizeKind {
  if (!a) return null;
  const text = `${a.item.category} ${a.item.name}`;
  if (SHOES.test(text)) return "shoes";
  if (CLOTHES.test(text)) return "clothes";
  return null;
}

export function effectiveSize(l: Listing) {
  return l.edits.size ?? l.analysis?.item.size ?? null;
}

export const SIZE_CHOICES: Record<"shoes" | "clothes", string[]> = {
  shoes: ["EU 36", "EU 37", "EU 38", "EU 39", "EU 40", "EU 41", "EU 42", "EU 43", "EU 44", "EU 45", "EU 46"],
  clothes: ["XS", "S", "M", "L", "XL", "XXL"],
};

// ---------------------------------------------------------------- seller's condition in the analysis

const CONDITION_WORDS: Record<Condition, string> = {
  new: "new with tags / unused",
  like_new: "like new, used a few times, no visible wear",
  good: "good, normal signs of use",
  fair: "fair, clearly worn or with small defects",
  poor: "poor, damaged or for parts",
};

/** Reads the condition the seller picked before the analysis (form field "condition"). */
export function sellerCondition(form: FormData): Condition | null {
  const v = form.get("condition");
  return typeof v === "string" && v in CONDITION_FACTOR ? (v as Condition) : null;
}

/** Adds the seller's condition to the note the AI reads, so it prices for exactly that. */
export function noteWithCondition(note: string | undefined, c: Condition | null) {
  if (!c) return note;
  const line = `The seller says the condition is: ${CONDITION_WORDS[c]}. Price it for exactly this condition (compare with listings in the same condition).`;
  return note ? `${note}\n${line}` : line;
}

/** Pricing rules every AI gets, so prices come from the right market, not retail or wishful asks. */
export const PRICING_RULES = `Pricing rules:
- Match the EXACT model/variant/size/storage; ignore listings of other versions, bundles or accessories only.
- Prefer SOLD / completed prices from the last few months; asking prices on Vinted, Bazoš, Aukro, eBay and Facebook are usually 10-20% above what things really sell for.
- Prefer listings in the seller's country; convert other currencies at today's rate.
- Compare with items in the SAME condition. Typical value vs new: like new ~85%, good ~70%, worn/fair ~50%, damaged/for parts ~30% (collectibles, sealed items and hyped brands can be higher).
- Ignore outliers (a single very high or very low listing). "suggested" should be what it realistically sells for within 1-2 weeks; "quickSale" within a few days.
- Put the real listings you used in "comparables" with correct currency and sold=true only when you know it sold.`;
