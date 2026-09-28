export const SHOPPING_SYSTEM = `You are Orbit, a shopping assistant inside a shopping app.
Help the user find the best, safest offer for what they want to buy.
- Compare prices across shops, including delivery cost and speed to the user's city.
- Always judge whether a shop is trustworthy: domain age, HTTPS, review volume and quality, return policy, company details, and prices that are too good to be true. Warn clearly about likely scams.
- When you use web search, cite the shops and prices you found.
- Keep answers short, friendly and scannable: bullets, bold prices, a clear recommendation at the end.
- Never ask for or repeat card numbers or passwords.`;

export type VerdictInput = {
  title: string;
  brand: string;
  typicalPrice: number;
  city: string;
  offers: { store: string; domain: string; price: number; trust: number }[];
};

export type Verdict = {
  verdict: "buy" | "wait" | "skip";
  headline: string;
  reasons: { kind: "pro" | "con"; text: string }[];
};

export function verdictPrompt(v: VerdictInput, live: boolean) {
  return `You advise shoppers in the Orbit app. Decide whether the shopper should buy this product now.
Product: ${v.brand} ${v.title}
Shopper's city: ${v.city}
Offers found (EUR, trust score 0-100 from Orbit's scam check): ${JSON.stringify(v.offers)}

${live ? "Use web search to check the usual price, reviews and whether a new model or a big sale is coming soon." : "You cannot browse; use what you know and be careful with claims about current prices."}
Verdict: "buy" (good price and product), "wait" (a better price or newer model is likely soon), or "skip" (poor product or a clearly better alternative).
Give exactly 3 short reasons (max 14 words each), each marked "pro" or "con". Mention one concrete alternative if there is a clearly better one. Be honest; don't invent numbers you're unsure of.
Reply with only JSON: {"verdict":"buy","headline":"Good price, strong reviews","reasons":[{"kind":"pro","text":"..."}]}`;
}

export function couponPrompt(store: string, domain: string, product: string) {
  return `Find currently working discount codes for the online shop ${store} (${domain}) that could apply to: ${product}.
Use web search. Only include codes published in the last 60 days on the shop's own site, its newsletter pages or reputable coupon sites. Never invent a code.
Reply with only JSON, at most 3: [{"code":"RUN10","description":"10% off running shoes","source":"site where you found it"}]. Reply [] if you find none.`;
}

/** Tolerant parse of a JSON value inside a model reply. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Keeps only well-formed verdict fields. */
export function cleanVerdict(raw: unknown): Verdict | null {
  const v = raw as Partial<Verdict> | null;
  if (!v || !["buy", "wait", "skip"].includes(String(v.verdict))) return null;
  const reasons = (Array.isArray(v.reasons) ? v.reasons : [])
    .map((r) => ({ kind: r?.kind === "con" ? ("con" as const) : ("pro" as const), text: String(r?.text ?? "").slice(0, 160) }))
    .filter((r) => r.text)
    .slice(0, 3);
  return { verdict: v.verdict as Verdict["verdict"], headline: String(v.headline ?? "").slice(0, 80), reasons };
}

export type Coupon = { code: string; description: string; source: string };

export function cleanCoupons(raw: unknown): Coupon[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => ({ code: String(c?.code ?? "").trim().slice(0, 40), description: String(c?.description ?? "").slice(0, 160), source: String(c?.source ?? "").slice(0, 80) }))
    .filter((c) => /^[A-Za-z0-9_-]{3,40}$/.test(c.code))
    .slice(0, 3);
}

/** Rule-based verdict used when no AI is available. */
export function heuristicVerdict(v: VerdictInput): Verdict {
  const safe = v.offers.filter((o) => o.trust >= 50).sort((a, b) => a.price - b.price);
  if (!safe.length) return { verdict: "skip", headline: "No safe shop sells it", reasons: [{ kind: "con", text: "Every offer failed Orbit's scam check." }] };
  const best = safe[0];
  const ratio = v.typicalPrice ? best.price / v.typicalPrice : 1;
  const reasons: Verdict["reasons"] = [
    ratio <= 0.95
      ? { kind: "pro", text: `About ${Math.round((1 - ratio) * 100)}% under its usual ${Math.round(v.typicalPrice)} EUR.` }
      : { kind: "con", text: "Price is around its usual level right now." },
    { kind: "pro", text: `${best.store} is trusted (score ${best.trust}).` },
    { kind: safe.length > 2 ? "pro" : "con", text: `${safe.length} safe ${safe.length === 1 ? "shop" : "shops"} to choose from.` },
  ];
  return ratio <= 0.95 ? { verdict: "buy", headline: "Good price at a trusted shop", reasons } : { verdict: "wait", headline: "Fair price, no deal right now", reasons };
}
