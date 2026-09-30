import { PLACES, type Place } from "./geo";

export type Store = {
  id: string;
  name: string;
  domain: string;
  /** Warehouse the parcel ships from. */
  warehouse: Place;
  rating: number;
  reviews: number;
  domainAgeYears: number;
  https: boolean;
  returnsDays: number;
  /** Signals a real check would pull from WHOIS, SSL, review sites and blocklists. */
  flags: string[];
};

export type Offer = {
  id: string;
  productId: string;
  storeId: string;
  price: number;
  condition: "new" | "refurbished";
  inStock: boolean;
  /** Link to the shop's product page (live results only). */
  url?: string;
};

export type Product = {
  id: string;
  title: string;
  brand: string;
  category: string;
  blurb: string;
  specs: string[];
  /** Two-stop gradient + glyph used for the product art tile. */
  art: { from: string; to: string; glyph: string };
  typicalPrice: number;
  /** Where the data came from: built-in sample, live web search, or AI estimate. */
  source?: "sample" | "web" | "estimate";
  /** Product photo (https) when the search found one; the art tile is the fallback. */
  image?: string;
};

const place = (city: string) => PLACES.find((p) => p.city === city)!;

export const STORES: Store[] = [
  { id: "alza", name: "Alza", domain: "alza.cz", warehouse: place("Prague"), rating: 4.7, reviews: 182_000, domainAgeYears: 22, https: true, returnsDays: 30, flags: [] },
  { id: "amazon-de", name: "Amazon.de", domain: "amazon.de", warehouse: place("Leipzig"), rating: 4.6, reviews: 2_400_000, domainAgeYears: 27, https: true, returnsDays: 30, flags: [] },
  { id: "mediamarkt", name: "MediaMarkt", domain: "mediamarkt.de", warehouse: place("Munich"), rating: 4.3, reviews: 96_000, domainAgeYears: 24, https: true, returnsDays: 14, flags: [] },
  { id: "bhphoto", name: "B&H Photo", domain: "bhphotovideo.com", warehouse: place("New York"), rating: 4.8, reviews: 410_000, domainAgeYears: 28, https: true, returnsDays: 30, flags: [] },
  { id: "aliexpress", name: "AliExpress", domain: "aliexpress.com", warehouse: place("Shenzhen"), rating: 4.1, reviews: 5_100_000, domainAgeYears: 15, https: true, returnsDays: 15, flags: ["Seller quality varies — check the individual seller"] },
  {
    id: "megadeals",
    name: "MegaDealz Outlet",
    domain: "megadealz-outlet.shop",
    warehouse: place("Singapore"),
    rating: 2.1,
    reviews: 37,
    domainAgeYears: 0.1,
    https: true,
    returnsDays: 0,
    flags: ["Domain registered 5 weeks ago", "Price 60% below market", "Only bank-transfer payment", "No company address or VAT ID", "Reviews copied from other sites"],
  },
];

export const PRODUCTS: Product[] = [
  { id: "airpods-pro-3", title: "AirPods Pro 3", brand: "Apple", category: "Audio", blurb: "Adaptive noise cancelling earbuds with heart-rate sensing.", specs: ["ANC", "USB-C", "IP57", "8h battery"], art: { from: "#f3efe6", to: "#dcd3c2", glyph: "🎧" }, typicalPrice: 249 },
  { id: "sony-xm6", title: "WH-1000XM6", brand: "Sony", category: "Audio", blurb: "Over-ear flagship with class-leading noise cancelling.", specs: ["ANC", "30h battery", "LDAC", "Multipoint"], art: { from: "#e7e3dc", to: "#b9b2a6", glyph: "🎧" }, typicalPrice: 429 },
  { id: "pixel-10", title: "Pixel 10 Pro", brand: "Google", category: "Phones", blurb: "Tensor G5, 7 years of updates, stellar camera.", specs: ["6.3\" OLED", "256 GB", "50 MP", "5G"], art: { from: "#e6ecf2", to: "#b8c6d6", glyph: "📱" }, typicalPrice: 999 },
  { id: "switch-2", title: "Switch 2", brand: "Nintendo", category: "Gaming", blurb: "The next-gen hybrid console with magnetic Joy-Con.", specs: ["1080p handheld", "4K docked", "256 GB"], art: { from: "#f6e3e0", to: "#e3a79e", glyph: "🎮" }, typicalPrice: 469 },
  { id: "kindle-scribe", title: "Kindle Scribe", brand: "Amazon", category: "Reading", blurb: "E-ink tablet you can read and write on.", specs: ["10.2\" 300ppi", "Premium pen", "32 GB"], art: { from: "#eef0e6", to: "#c6ccb0", glyph: "📖" }, typicalPrice: 399 },
  { id: "dyson-v15", title: "V15 Detect", brand: "Dyson", category: "Home", blurb: "Cordless vacuum with laser dust detection.", specs: ["60 min run", "Laser head", "LCD counter"], art: { from: "#f1e9f3", to: "#cdb3d4", glyph: "🧹" }, typicalPrice: 649 },
  { id: "garmin-fenix", title: "Fēnix 8", brand: "Garmin", category: "Wearables", blurb: "Rugged multisport GPS watch with AMOLED display.", specs: ["AMOLED", "16 days", "Maps", "Dive-rated"], art: { from: "#e4efe9", to: "#a9cbb8", glyph: "⌚" }, typicalPrice: 899 },
  { id: "lego-falcon", title: "Millennium Falcon UCS", brand: "LEGO", category: "Toys", blurb: "7,541-piece collector's model.", specs: ["7541 pcs", "84 cm long", "18+"], art: { from: "#f5eddc", to: "#e2c78e", glyph: "🧱" }, typicalPrice: 849 },
];

// Deterministic offers per product; the scam store always undercuts heavily so
// the safety check has something to catch.
const OFFER_MATRIX: Record<string, [string, number][]> = {
  "airpods-pro-3": [["alza", 1.0], ["amazon-de", 0.94], ["mediamarkt", 0.98], ["aliexpress", 0.9], ["megadeals", 0.41]],
  "sony-xm6": [["alza", 0.97], ["amazon-de", 0.91], ["bhphoto", 0.93], ["mediamarkt", 1.0], ["megadeals", 0.38]],
  "pixel-10": [["alza", 0.96], ["amazon-de", 0.92], ["bhphoto", 0.9], ["mediamarkt", 0.99], ["megadeals", 0.42]],
  "switch-2": [["alza", 1.0], ["amazon-de", 0.97], ["mediamarkt", 0.99], ["bhphoto", 0.96]],
  "kindle-scribe": [["amazon-de", 0.88], ["alza", 0.97], ["mediamarkt", 1.0]],
  "dyson-v15": [["alza", 0.93], ["amazon-de", 0.9], ["mediamarkt", 0.95], ["aliexpress", 0.82], ["megadeals", 0.35]],
  "garmin-fenix": [["alza", 0.95], ["amazon-de", 0.9], ["bhphoto", 0.87], ["mediamarkt", 0.99]],
  "lego-falcon": [["alza", 0.97], ["amazon-de", 0.92], ["mediamarkt", 1.0], ["aliexpress", 0.7], ["megadeals", 0.33]],
};

export const OFFERS: Offer[] = PRODUCTS.flatMap((p) =>
  (OFFER_MATRIX[p.id] ?? []).map(([storeId, factor]) => ({
    id: `${p.id}__${storeId}`,
    productId: p.id,
    storeId,
    price: Math.round(p.typicalPrice * factor) - 0.01,
    condition: "new" as const,
    inStock: true,
  })),
);

// Products found by live/AI search are registered here at runtime (browser only)
// and persisted so product and checkout pages survive a reload.
const DYN_KEY = "orbit.catalog.v1";
const dyn = { products: new Map<string, Product>(), stores: new Map<string, Store>(), offers: new Map<string, Offer>(), loaded: false };

function loadDynamic() {
  if (dyn.loaded || typeof window === "undefined") return;
  dyn.loaded = true;
  try {
    const raw = window.localStorage.getItem(DYN_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { products: Product[]; stores: Store[]; offers: Offer[] };
    saved.products.forEach((p) => dyn.products.set(p.id, p));
    saved.stores.forEach((st) => dyn.stores.set(st.id, st));
    saved.offers.forEach((o) => dyn.offers.set(o.id, o));
  } catch {
    // Storage unavailable: keep results in memory only.
  }
}

export function registerDynamic(products: Product[], stores: Store[], offers: Offer[]) {
  loadDynamic();
  products.forEach((p) => dyn.products.set(p.id, p));
  stores.forEach((st) => dyn.stores.set(st.id, st));
  offers.forEach((o) => dyn.offers.set(o.id, o));
  // Keep the most recent 80 products and whatever they reference.
  const keep = [...dyn.products.values()].slice(-80);
  const offersKept = [...dyn.offers.values()].filter((o) => keep.some((p) => p.id === o.productId));
  const storesKept = [...dyn.stores.values()].filter((st) => offersKept.some((o) => o.storeId === st.id));
  try {
    window.localStorage.setItem(DYN_KEY, JSON.stringify({ products: keep, stores: storesKept, offers: offersKept }));
  } catch {
    // ignore
  }
}

export const getStaticProduct = (id: string) => PRODUCTS.find((p) => p.id === id);
export const getProduct = (id: string) => {
  loadDynamic();
  return getStaticProduct(id) ?? dyn.products.get(id);
};
export const getStore = (id: string) => {
  loadDynamic();
  return STORES.find((s) => s.id === id) ?? dyn.stores.get(id);
};
export const getOffer = (id: string) => {
  loadDynamic();
  return OFFERS.find((o) => o.id === id) ?? dyn.offers.get(id);
};
export const offersFor = (productId: string) => {
  loadDynamic();
  return [...OFFERS, ...dyn.offers.values()].filter((o) => o.productId === productId);
};

export function searchProducts(q: string): Product[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return PRODUCTS;
  return PRODUCTS.filter((p) => {
    const hay = `${p.title} ${p.brand} ${p.category} ${p.blurb}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export const CATEGORIES = Array.from(new Set(PRODUCTS.map((p) => p.category)));
