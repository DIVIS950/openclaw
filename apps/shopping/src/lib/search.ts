import { registerDynamic, type Offer, type Product, type Store } from "./data";
import { findPlace, PLACES } from "./geo";

/** One product line as Claude writes it (JSON Lines). Values are untrusted: normalize() coerces. */
export type RawProduct = {
  title?: unknown;
  brand?: unknown;
  category?: unknown;
  emoji?: unknown;
  blurb?: unknown;
  specs?: unknown;
  typicalPrice?: unknown;
  offers?: unknown;
  image?: unknown;
};

type RawOffer = {
  store?: unknown;
  domain?: unknown;
  price?: unknown;
  url?: unknown;
  warehouseCity?: unknown;
  https?: unknown;
  domainAgeYears?: unknown;
  rating?: unknown;
  reviews?: unknown;
  returnsDays?: unknown;
  flags?: unknown;
};

export const POPULAR = ["Running shoes", "Robot vacuum", "iPhone 17 Pro", "Espresso machine", "Gaming laptop", "Kids bike", "Air fryer", "4K TV 55 inch"];

const CITY_LIST = PLACES.map((p) => p.city).join(", ");

/**
 * Instructions shared by the server (live web search) and the web demo (Claude
 * from knowledge). Output is JSON Lines so results can render as they stream.
 */
export function searchPrompt(query: string, city: string, live: boolean) {
  return `You are the search engine of Orbit, a shopping app that compares every shop.
The shopper typed: "${query.slice(0, 200)}"
They live in ${city}. Show prices in EUR (convert if needed).

${
  live
    ? "Use web search to find CURRENT prices at real shops that deliver to the shopper's country. Prefer big trusted retailers plus marketplaces."
    : "You cannot browse. Use your knowledge of real products, real shops and typical current prices. Be realistic; these are estimates."
}

Find up to 6 relevant real products (different models or variants that match the request), each with 3-6 offers from real shops.
For each shop, honestly assess trust: HTTPS, approximate domain age in years, rating out of 5, approximate review count, return window in days, and red flags (empty list if none). If lookalike or scam shops commonly sell this item, you may include one with its red flags, but never invent problems for real retailers.
warehouseCity must be the closest city from this list: ${CITY_LIST}.

Output format: JSON Lines. One product per line, no markdown, no numbering, no other text. Each line is exactly one object:
{"title":"...","brand":"...","category":"...","emoji":"one emoji","blurb":"one short sentence","specs":["up to 4 short specs"],"typicalPrice":123,"image":"https://... direct link to a product photo (jpg/png/webp) from the maker or a shop, or null","offers":[{"store":"Shop name","domain":"shop.com","price":119.99,"url":"https://...","warehouseCity":"Berlin","https":true,"domainAgeYears":12,"rating":4.5,"reviews":20000,"returnsDays":30,"flags":[]}]}
Use null for url when you do not know the exact product page.`;
}

const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, fallback = 0) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

// Warm pastel pairs for product art tiles.
const ART = [
  ["#f3efe6", "#dcd3c2"],
  ["#e6ecf2", "#b8c6d6"],
  ["#f6e3e0", "#e3a79e"],
  ["#eef0e6", "#c6ccb0"],
  ["#f1e9f3", "#cdb3d4"],
  ["#e4efe9", "#a9cbb8"],
  ["#f5eddc", "#e2c78e"],
  ["#e9e7f4", "#b7b1dc"],
];

function safeUrl(v: unknown) {
  const u = str(v, 500);
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Turns one untrusted product object into catalog entries and registers them. */
export function normalize(raw: RawProduct, source: "web" | "estimate"): Product | null {
  const title = str(raw.title, 90);
  const offersRaw = Array.isArray(raw.offers) ? (raw.offers as RawOffer[]).slice(0, 8) : [];
  if (!title || !offersRaw.length) return null;

  const brand = str(raw.brand, 40) || title.split(" ")[0];
  const id = `x-${slug(`${brand} ${title}`)}-${(hash(title + brand) % 1e6).toString(36)}`;
  const [from, to] = ART[hash(title) % ART.length];
  // Keep only the first emoji-ish grapheme; fall back to a bag.
  const glyph = [...str(raw.emoji, 8)].slice(0, 2).join("") || "🛍️";

  const stores: Store[] = [];
  const offers: Offer[] = [];
  for (const o of offersRaw) {
    const name = str(o.store, 50);
    const price = num(o.price, NaN);
    if (!name || !(price > 0)) continue;
    const domain = str(o.domain, 80).replace(/^https?:\/\//, "").replace(/\/.*$/, "") || `${slug(name)}.com`;
    const storeId = `s-${slug(domain)}`;
    if (!stores.some((s) => s.id === storeId)) {
      stores.push({
        id: storeId,
        name,
        domain,
        warehouse: findPlace(str(o.warehouseCity, 40)) ?? findPlace("Berlin")!,
        rating: Math.max(0, Math.min(5, num(o.rating, 4))),
        reviews: Math.max(0, Math.round(num(o.reviews, 1000))),
        domainAgeYears: Math.max(0, num(o.domainAgeYears, 5)),
        https: o.https !== false,
        returnsDays: Math.max(0, Math.round(num(o.returnsDays, 14))),
        flags: Array.isArray(o.flags) ? (o.flags as unknown[]).map((f) => str(f, 120)).filter(Boolean).slice(0, 6) : [],
      });
    }
    offers.push({ id: `${id}__${storeId}`, productId: id, storeId, price: Math.round(price * 100) / 100, condition: "new", inStock: true, url: safeUrl(o.url) });
  }
  if (!offers.length) return null;

  const prices = offers.map((o) => o.price).sort((a, b) => a - b);
  const product: Product = {
    id,
    title,
    brand,
    category: str(raw.category, 30) || "Shopping",
    blurb: str(raw.blurb, 160),
    specs: Array.isArray(raw.specs) ? (raw.specs as unknown[]).map((s) => str(s, 30)).filter(Boolean).slice(0, 4) : [],
    art: { from, to, glyph },
    // Median price is the market reference used by the scam check.
    typicalPrice: num(raw.typicalPrice, 0) || prices[Math.floor(prices.length / 2)],
    source,
    image: source === "web" ? safeUrl(raw.image) : undefined,
  };
  registerDynamic([product], stores, offers);
  return product;
}

/** Incremental JSON Lines reader: feed it growing text, it emits each complete object once. */
export function lineReader(onObject: (value: RawProduct) => void) {
  let consumed = 0;
  const tryLine = (line: string) => {
    // Narration can share a line with the object ("Here you go: {...}"), so start at the first brace.
    const start = line.indexOf("{");
    if (start < 0) return;
    const t = line.slice(start).trim().replace(/```$/, "").trim();
    try {
      onObject(JSON.parse(t) as RawProduct);
    } catch {
      // Not a complete JSON object (narration or a split line): skip.
    }
  };
  return {
    push(fullText: string) {
      const lastNl = fullText.lastIndexOf("\n");
      if (lastNl < consumed) return;
      fullText.slice(consumed, lastNl).split("\n").forEach(tryLine);
      consumed = lastNl + 1;
    },
    end(fullText: string) {
      fullText.slice(consumed).split("\n").forEach(tryLine);
      consumed = fullText.length;
    },
  };
}
