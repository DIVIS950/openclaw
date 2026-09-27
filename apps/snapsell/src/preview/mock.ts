/**
 * Web preview backend. Only bundled in `vite build --mode preview`.
 * Answers the app's /api, /photos and /auth requests inside the page, so the real UI runs
 * as a static web page: sample listings, demo AI analysis, simulated posting.
 */
import { finalizeAnalysis, sellerCondition } from "../../shared/pricing.ts";
import { demoAnalysis } from "../../server/ai/demo.ts";
import {
  DEFAULT_SETTINGS,
  PLATFORMS,
  type Analysis,
  type AnalyzeEvent,
  type Listing,
  type Platform,
  type PlatformStatus,
  type Settings,
} from "../../shared/types.ts";
import { photoResolver } from "../lib/api.ts";

const ME = { email: "you@example.com", name: "You", authEnabled: false };
const photos = new Map<string, Blob>(); // "<id>/<name>" → image
const urls = new Map<string, string>(); // same key → blob: URL
const listings = new Map<string, Listing>();
let settings: Settings = {
  ...DEFAULT_SETTINGS,
  country: "Czechia",
  currency: "CZK",
  language: "Czech",
  vintedDomain: "www.vinted.cz",
  onboarded: true,
};

try {
  const saved = localStorage.getItem("snapsell-preview-settings");
  if (saved) settings = { ...settings, ...JSON.parse(saved) };
} catch {
  // storage blocked: defaults are fine
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const id8 = () => Math.random().toString(36).slice(2, 10);

function putPhoto(id: string, name: string, blob: Blob) {
  const key = `${id}/${name}`;
  photos.set(key, blob);
  urls.set(key, URL.createObjectURL(blob));
}

photoResolver.resolve = (path) => {
  const key = path.replace(/^.*\/photos\//, "");
  return urls.get(key) ?? path;
};

// ---------------------------------------------------------------- sample data

const ART: Record<string, { bg: string; svg: string }> = {
  headphones: {
    bg: "#D9CFBD",
    svg: '<path d="M40 120 V100 a60 60 0 0 1 120 0 V120" fill="none" stroke="#17150F" stroke-width="12" stroke-linecap="round"/><rect x="28" y="108" width="36" height="58" rx="16" fill="#17150F"/><rect x="136" y="108" width="36" height="58" rx="16" fill="#17150F"/><rect x="36" y="118" width="20" height="38" rx="9" fill="#3A372F"/><rect x="144" y="118" width="20" height="38" rx="9" fill="#3A372F"/>',
  },
  sneaker: {
    bg: "#CFE0D8",
    svg: '<path d="M30 130 C30 110 40 95 55 92 L80 88 C90 100 105 104 120 104 L150 112 C165 116 172 124 172 134 L172 142 L30 142 Z" fill="#FAFAF7" stroke="#17150F" stroke-width="5" stroke-linejoin="round"/><path d="M30 142 H172 V150 H30 Z" fill="#17150F"/><path d="M70 100 L78 116 M86 100 L94 116 M102 104 L108 118" stroke="#17150F" stroke-width="4" stroke-linecap="round"/><path d="M120 118 C135 118 150 124 160 134" stroke="#FF5B24" stroke-width="6" fill="none" stroke-linecap="round"/>',
  },
  camera: {
    bg: "#E8D3C7",
    svg: '<rect x="30" y="70" width="140" height="84" rx="12" fill="#17150F"/><rect x="30" y="92" width="140" height="40" fill="#8A8373"/><rect x="50" y="58" width="36" height="16" rx="4" fill="#17150F"/><circle cx="100" cy="112" r="30" fill="#2B2922" stroke="#D9D3C4" stroke-width="5"/><circle cx="100" cy="112" r="14" fill="#4B5D6B"/>',
  },
  lamp: {
    bg: "#D7D9E6",
    svg: '<path d="M70 50 H130 L150 100 H50 Z" fill="#E9B949" stroke="#17150F" stroke-width="5" stroke-linejoin="round"/><path d="M100 100 V160" stroke="#17150F" stroke-width="6"/><rect x="70" y="158" width="60" height="10" rx="5" fill="#17150F"/>',
  },
};

/** Draws a sample "photo" (illustration on a soft studio backdrop) as a JPEG. */
async function samplePhoto(kind: keyof typeof ART, angle = 0) {
  const { bg, svg } = ART[kind];
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/><ellipse cx="100" cy="172" rx="62" ry="6" fill="#17150F" opacity="0.12"/><g transform="rotate(${angle} 100 110) translate(10 10) scale(0.9)">${svg}</g></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = 800;
  c.getContext("2d")!.drawImage(img, 0, 0, 800, 800);
  return new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.9));
}

function analysis(o: {
  name: string;
  brand: string;
  model: string;
  category: string;
  color: string;
  size?: string;
  era?: string;
  condition: Analysis["condition"];
  conditionNotes: string;
  price: [number, number, number, number];
  reasoning: string;
  comps: [string, number, string, boolean][];
  copy: Record<Platform, [string, string]>;
  attributes: [string, string][];
  tags: string[];
}): Analysis {
  const [low, high, suggested, quickSale] = o.price;
  return {
    item: { name: o.name, brand: o.brand, model: o.model, category: o.category, color: o.color, material: null, size: o.size ?? null, era: o.era ?? null },
    confidence: 0.93,
    identificationNotes: "",
    condition: o.condition,
    conditionNotes: o.conditionNotes,
    price: { currency: "CZK", low, high, suggested, quickSale, demand: "high", reasoning: o.reasoning },
    comparables: o.comps.map(([title, price, source, sold]) => ({ title, price, currency: "CZK", source, url: null, sold })),
    title: o.copy.ebay[0],
    description: o.copy.ebay[1],
    platforms: {
      ebay: { title: o.copy.ebay[0], description: o.copy.ebay[1] },
      facebook: { title: o.copy.facebook[0], description: o.copy.facebook[1] },
      vinted: { title: o.copy.vinted[0], description: o.copy.vinted[1] },
    },
    tags: o.tags,
    attributes: o.attributes.map(([name, value]) => ({ name, value })),
    crops: [{ photo: 0, x: 0.1, y: 0.1, w: 0.8, h: 0.8 }],
    photoTips: [],
    shipping: { weightKg: 0.8, packageSize: "medium" },
  };
}

async function seed() {
  const day = 86_400_000;
  const now = Date.now();
  const make = async (
    kind: keyof typeof ART,
    status: Listing["status"],
    ageDays: number,
    a: Analysis,
    publish: Listing["publish"] = {},
    soldAfterDays?: number,
  ) => {
    const id = id8();
    putPhoto(id, "photo-0.jpeg", await samplePhoto(kind));
    putPhoto(id, "photo-1.jpeg", await samplePhoto(kind, -8));
    const created = new Date(now - ageDays * day).toISOString();
    listings.set(id, {
      id,
      owner: ME.email,
      createdAt: created,
      updatedAt: created,
      soldAt: soldAfterDays !== undefined ? new Date(now - (ageDays - soldAfterDays) * day).toISOString() : undefined,
      status,
      photos: ["photo-0.jpeg", "photo-1.jpeg"],
      enhanced: [],
      analysis: a,
      edits: {},
      publish,
    });
  };
  const live = (url: string, message: string) => ({ status: "live" as const, message, url });

  await make(
    "lamp",
    "sold",
    4,
    analysis({
      name: "IKEA desk lamp, brass finish",
      brand: "IKEA",
      model: "Desk lamp",
      category: "Lighting",
      color: "Brass",
      condition: "good",
      conditionNotes: "Small scuffs on the base, works perfectly.",
      price: [290, 490, 390, 340],
      reasoning: "Used IKEA desk lamps sell for 300–450 Kč locally. Brass finish is popular.",
      comps: [["IKEA lampa mosaz", 420, "Bazoš", true], ["IKEA desk lamp", 350, "Facebook Marketplace", true]],
      copy: {
        ebay: ["IKEA Desk Lamp Brass Finish Adjustable", "IKEA desk lamp in brass finish. Fully working."],
        facebook: ["IKEA stolní lampa, mosaz", "Funkční, drobné škrábance na podstavci. Osobní předání."],
        vinted: ["IKEA lampa mosaz", "Stolní lampa IKEA, plně funkční. #ikea #lampa #domov"],
      },
      attributes: [["Brand", "IKEA"], ["Color", "Brass"]],
      tags: ["ikea", "lampa", "desk lamp"],
    }),
    { facebook: live("https://www.facebook.com/marketplace/you/selling", "Sold on Facebook Marketplace") },
    2,
  );
  await make(
    "camera",
    "draft",
    1,
    analysis({
      name: "Canon AE-1 Program 35mm film camera",
      brand: "Canon",
      model: "AE-1 Program",
      category: "Film cameras",
      color: "Black / silver",
      era: "1981",
      condition: "good",
      conditionNotes: "Light wear on the top plate, shutter fires, light seals look original.",
      price: [3400, 5200, 4200, 3700],
      reasoning: "Working AE-1 Program bodies sell for 3 500–5 000 Kč; with a 50mm lens toward the top.",
      comps: [["Canon AE-1 Program + 50mm 1.8", 4900, "eBay sold", true], ["Canon AE-1P tělo", 3600, "Vinted", true], ["Canon AE-1 Program", 4400, "Bazoš", false]],
      copy: {
        ebay: ["Canon AE-1 Program 35mm SLR Film Camera Body Tested Working", "Canon AE-1 Program in good working condition.\n\nCONDITION\n• Shutter fires at all speeds\n• Light wear on top plate"],
        facebook: ["Canon AE-1 Program, filmový foťák", "Funkční Canon AE-1 Program. Závěrka jde na všech časech. Možnost vyzkoušet."],
        vinted: ["Canon AE-1 Program film", "Kultovní filmový foťák, funkční. #canon #film #analog #35mm"],
      },
      attributes: [["Brand", "Canon"], ["Model", "AE-1 Program"], ["Format", "35mm"], ["Year", "1981"]],
      tags: ["canon", "ae-1", "film camera", "35mm"],
    }),
  );
  await make(
    "sneaker",
    "live",
    5,
    analysis({
      name: "Nike Air Max 90, size 42",
      brand: "Nike",
      model: "Air Max 90",
      category: "Sneakers",
      color: "White / black",
      size: "EU 42",
      condition: "like_new",
      conditionNotes: "Worn a few times, soles clean, no creasing.",
      price: [1100, 1900, 1450, 1250],
      reasoning: "Air Max 90 in EU 42 sells for 1 200–1 800 Kč on Vinted in like-new condition.",
      comps: [["Nike Air Max 90 vel. 42", 1500, "Vinted", true], ["Air Max 90 white", 1350, "Vinted", true]],
      copy: {
        ebay: ["Nike Air Max 90 White Black EU 42 US 8.5 Like New", "Nike Air Max 90, EU 42. Worn a few times."],
        facebook: ["Nike Air Max 90, vel. 42", "Skoro nenošené, podrážka čistá. Posílám i osobně."],
        vinted: ["Nike Air Max 90 vel. 42", "Nošené párkrát, jako nové. #nike #airmax #tenisky"],
      },
      attributes: [["Brand", "Nike"], ["Model", "Air Max 90"], ["Size", "EU 42"]],
      tags: ["nike", "air max", "sneakers"],
    }),
    { vinted: live("https://www.vinted.cz/", "Posted on Vinted") },
  );
  await make(
    "headphones",
    "live",
    2,
    analysis({
      name: "Sony WH-1000XM4 Wireless Noise Cancelling Headphones",
      brand: "Sony",
      model: "WH-1000XM4",
      category: "Headphones",
      color: "Black",
      era: "2020",
      condition: "good",
      conditionNotes: "Light wear on the headband, ear pads intact, no cracks.",
      price: [2900, 4600, 3790, 3290],
      reasoning: "23 sold listings cluster between 3 200 and 4 300 Kč. Complete sets with the case sell toward the top.",
      comps: [["Sony WH-1000XM4 černá, s pouzdrem", 3900, "eBay sold", true], ["Sony XM4", 3400, "Vinted", true], ["Sony WH-1000XM4 jako nové", 4400, "Facebook Marketplace", false]],
      copy: {
        ebay: ["Sony WH-1000XM4 Wireless Noise Cancelling Headphones Black Bluetooth", "Sony WH-1000XM4, black, fully working.\n\nCONDITION\n• Light wear on the headband\n• Ear pads intact, no cracks\n\nINCLUDED\n• Headphones, carrying case, USB-C cable\n\nShips within 1 day, well packed."],
        facebook: ["Sony WH-1000XM4 sluchátka s potlačením hluku", "Prodám Sony XM4. Fungují perfektně, potlačení hluku super.\nLehce ošoupaný pásek, náušníky v pořádku.\nS pouzdrem a kabelem. Osobně nebo poštou."],
        vinted: ["Sony WH-1000XM4 černá", "Bezdrátová sluchátka Sony, plně funkční. Pouzdro a kabel v ceně. #sony #sluchatka #wh1000xm4"],
      },
      attributes: [["Brand", "Sony"], ["Model", "WH-1000XM4"], ["Color", "Black"], ["Connectivity", "Bluetooth"]],
      tags: ["sony", "wh-1000xm4", "headphones"],
    }),
    {
      ebay: live("https://www.ebay.com/", "Live on eBay"),
      facebook: live("https://www.facebook.com/marketplace/", "Posted on Facebook Marketplace"),
    },
  );
}

// ---------------------------------------------------------------- API

function platformStatuses(): PlatformStatus[] {
  return [
    { platform: "ebay", mode: "api", connected: true, detail: "Preview · connected with the official eBay API" },
    { platform: "facebook", mode: "extension", connected: true, detail: "Preview · posted by SnapSell for Chrome" },
    { platform: "vinted", mode: "extension", connected: true, detail: "Preview · posted by SnapSell for Chrome" },
  ];
}

/** Pretend-posting: progress messages, then live (eBay) or waiting for your final click. */
async function simulatePublish(l: Listing, p: Platform) {
  const set = (state: NonNullable<Listing["publish"][Platform]>) => {
    l.publish[p] = { ...state, updatedAt: new Date().toISOString() };
    if (state.status === "live") l.status = "live";
  };
  const steps =
    p === "ebay"
      ? ["Uploading photos to eBay", "Finding the right category", "Creating the listing", "Publishing"]
      : ["Sent to your Chrome", "Uploading photos", "Filling in title and price", "Choosing category and condition", "Writing the description"];
  for (const m of steps) {
    set({ status: "working", message: m });
    await sleep(1200);
  }
  if (p === "ebay") return set({ status: "live", message: "Live on eBay (preview)", url: "https://www.ebay.com/" });
  const site = p === "facebook" ? "Facebook" : "Vinted";
  if (!settings.autoPublish) {
    return set({ status: "needs_review", message: `Filled in on ${site}. In the real app your Chrome now shows the form; press Publish there.` });
  }
  set({ status: "live", message: `Posted on ${site} (preview)`, url: p === "facebook" ? "https://www.facebook.com/marketplace/" : `https://${settings.vintedDomain}/` });
}

function analyzeStream(form: FormData) {
  const files = form.getAll("photos").filter((f): f is File => f instanceof File);
  const now = new Date().toISOString();
  const l: Listing = { id: id8(), owner: ME.email, createdAt: now, updatedAt: now, status: "analyzing", photos: [], enhanced: [], edits: {}, publish: {} };
  files.slice(0, 12).forEach((f, i) => {
    const name = `photo-${i}.jpeg`;
    putPhoto(l.id, name, f);
    l.photos.push(name);
  });
  listings.set(l.id, l);
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (e: AnalyzeEvent | { type: "listing"; listing: Listing }) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      send({ type: "listing", listing: l });
      const a = await demoAnalysis(l.photos.length, settings, send);
      a.identificationNotes = "Web preview: these are sample AI results. In the real app Claude analyzes your own photos.";
      l.analysis = finalizeAnalysis(a, sellerCondition(form));
      l.status = "draft";
      send({ type: "stage", stage: "done" });
      send({ type: "listing", listing: l });
      ctrl.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

async function handle(path: string, method: string, init?: RequestInit): Promise<Response> {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  let m: RegExpMatchArray | null;

  if (path.startsWith("/photos/")) {
    const blob = photos.get(path.slice("/photos/".length));
    return blob ? new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg" } }) : new Response("", { status: 404 });
  }
  if (path === "/api/health") {
    return json({ ai: false, demo: true, preview: true, model: "claude-opus-5", googleLogin: false, lens: { vision: true, serpapi: true }, ebayApp: true });
  }
  if (path === "/api/me") return json(ME);
  if (path === "/auth/logout") return json({ ok: true });
  if (path === "/api/settings") {
    if (method === "PUT") {
      settings = { ...settings, ...body };
      try {
        localStorage.setItem("snapsell-preview-settings", JSON.stringify(settings));
      } catch {
        // storage blocked: settings last for this visit only
      }
    }
    return json(settings);
  }
  if (path === "/api/platforms") return json(platformStatuses());
  if (path === "/api/extension") return json({ online: true, paired: true, lastSeen: new Date().toISOString(), sites: { facebook: true, vinted: true } });
  if (path === "/api/extension/pair") return json({ token: "ss_preview-only-code", server: "https://your-computer.your-tailnet.ts.net" });
  if (path.startsWith("/api/ebay/")) return json(platformStatuses()[0]);
  if (path === "/api/analyze") return analyzeStream(init!.body as FormData);
  if (path === "/api/listings") return json([...listings.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

  if ((m = path.match(/^\/api\/listings\/(\w+)(?:\/(\w+))?$/))) {
    const l = listings.get(m[1]);
    if (!l) return json({ error: "Not found" }, 404);
    const sub = m[2];
    if (!sub && method === "GET") return json(l);
    if (!sub && method === "DELETE") {
      listings.delete(l.id);
      return json({ ok: true });
    }
    if (!sub && method === "PATCH") {
      if (body.edits) l.edits = { ...l.edits, ...body.edits };
      if (body.status) {
        if (body.status === "sold" && l.status !== "sold") l.soldAt = new Date().toISOString();
        l.status = body.status;
      }
      return json(l);
    }
    if (sub === "photo-plan" && method === "POST") {
      // Sample plan for the web preview.
      await new Promise((r) => setTimeout(r, 900));
      return json({ rotate: 0, crop: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, exposure: 0.3, contrast: 0.2, warmth: -0.1, saturation: 0.1, shadows: 0.4, highlights: 0.2, background: "white", reason: "Brighter, a touch cooler, clean white backdrop." });
    }
    if (sub === "assistant" && method === "POST") {
      // Sample answers for the web preview: a number sets the price, anything else gets advice.
      await new Promise((r) => setTimeout(r, 700));
      const text = String(body?.text ?? "");
      const num = /(\d[\d\s]{1,6})/.exec(text)?.[1]?.replace(/\s/g, "");
      const changes = num ? { price: Number(num) } : {};
      if (num) l.edits = { ...l.edits, price: Number(num) };
      const reply = num
        ? `Hotovo, cenu jsem změnil na ${num} korun.`
        : `Podobné kusy se prodávají kolem ${l.analysis?.price.suggested ?? 0} korun, to je dobrá cena pro rychlý prodej.`;
      return json({ reply, changes, listing: l });
    }
    if (sub === "enhanced") {
      const stamp = Date.now().toString(36);
      l.enhanced = (init!.body as FormData)
        .getAll("photos")
        .filter((f): f is File => f instanceof File)
        .map((f, i) => {
          const name = `enhanced-${i}-${stamp}.jpeg`;
          putPhoto(l.id, name, f);
          return name;
        });
      return json(l);
    }
    if (sub === "publish") {
      for (const p of (body.platforms as Platform[]).filter((x) => PLATFORMS.includes(x))) {
        l.publish[p] = { status: "working", message: "Starting", updatedAt: new Date().toISOString() };
        void simulatePublish(l, p);
      }
      return json(l);
    }
  }
  return json({ error: `Not available in the preview: ${path}` }, 404);
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  const m = url.pathname.match(/\/(api|photos|auth)\/.*$/);
  if (!m || url.origin !== location.origin) return realFetch(input, init);
  // Photos are served from memory; everything else gets a short, realistic delay.
  if (m[1] !== "photos") await sleep(120);
  return handle(m[0], (init?.method ?? "GET").toUpperCase(), init);
};

await seed();
