/**
 * SnapSell as a Claude page (artifact). Only bundled in `vite build --mode hosted`.
 * Nothing to set up: Claude does the AI on the viewer's own Claude account (`sample`),
 * listings live in the page's database (`db`) and photos in its file store (`assets`).
 * The page can't reach other websites, so prices are Claude's estimate (no live search)
 * and posting is copy & open.
 */
import { applyAssistantChanges, assistantPrompt, parseAssistantReply } from "../../shared/assistant.ts";
import { normalizePhotoPlan, photoPlanJsonSchema, photoPlanPrompt } from "../../shared/photoPlan.ts";
import { PRICING_RULES, finalizeAnalysis, noteWithCondition, sellerCondition } from "../../shared/pricing.ts";
import { demoAnalysis } from "../../server/ai/demo.ts";
import {
  AnalysisSchema,
  CONDITIONS,
  DEFAULT_SETTINGS,
  type Analysis,
  type AnalyzeEvent,
  type Listing,
  type PlatformStatus,
  type Settings,
} from "../../shared/types.ts";
import { prepareForUpload } from "../lib/image.ts";
import { photoResolver } from "../lib/api.ts";
import { REGIONS } from "../lib/regions.ts";

type Sample = ((input: string, opts?: Record<string, unknown>) => Promise<{ text: string }>) & {
  json: <T>(input: string, opts?: Record<string, unknown>) => Promise<T>;
  limits: () => Promise<{ images?: { maxCount: number } }>;
};
type DocRef = { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>; set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> };
type Db = { doc(path: string): DocRef; collection(path: string): { get(): Promise<{ docs: { id: string; data(): Record<string, unknown> | undefined }[] }> } };
type Assets = { upload(blob: Blob, opts?: Record<string, unknown>): Promise<{ id: string; url: string }>; delete(id: string): Promise<unknown> };
type ClaudeRuntime = { use(name: string): Promise<unknown> };
type Mcp = { callTool(server: string, tool: string, input: Record<string, unknown>): Promise<{ payload?: unknown }> };

const ME = { email: "you@claude", name: "You", authEnabled: false };
const w = window as unknown as { claude?: ClaudeRuntime };
const [sample, db, assets, mcp] = (await Promise.all(
  ["sample", "db", "assets", "mcp"].map((n) => w.claude?.use(n).catch(() => null) ?? Promise.resolve(null)),
)) as [Sample | null, Db | null, Assets | null, Mcp | null];

let settings: Settings = { ...DEFAULT_SETTINGS };
const listings = new Map<string, Listing>();
// Photos taken this visit before their upload finished, and fallbacks when assets are unavailable.
const localPhotos = new Map<string, Blob>();
const localUrls = new Map<string, string>();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const id8 = () => Math.random().toString(36).slice(2, 10);

// Photo names ARE asset ids here, so /photos/<listing>/<assetId> is served from /_blob/<assetId>.
photoResolver.resolve = (path) => {
  const name = path.replace(/^.*\/photos\/[^/]+\//, "");
  return localUrls.get(name) ?? (assets ? `/_blob/${name}` : path);
};

async function storePhoto(blob: Blob): Promise<string> {
  if (assets) {
    try {
      const { id } = await assets.upload(blob, { type: blob.type || "image/jpeg" });
      localUrls.set(id, URL.createObjectURL(blob)); // instant display this visit
      localPhotos.set(id, blob);
      return id;
    } catch {
      // fall through: keep it for this visit only
    }
  }
  const id = `local-${id8()}`;
  localPhotos.set(id, blob);
  localUrls.set(id, URL.createObjectURL(blob));
  return id;
}

async function photoBlob(name: string): Promise<Blob | null> {
  if (localPhotos.has(name)) return localPhotos.get(name)!;
  if (!assets) return null;
  const res = await realFetch(`/_blob/${name}`);
  return res.ok ? res.blob() : null;
}

async function saveListing(l: Listing) {
  l.updatedAt = new Date().toISOString();
  listings.set(l.id, l);
  await db?.doc(`listings/${l.id}`).set(JSON.parse(JSON.stringify(l))).catch(() => {});
}

async function saveSettings() {
  await db?.doc("settings/main").set({ ...settings }).catch(() => {});
}

// ---------------------------------------------------------------- AI

const SHAPE = `{
  "item": {"name": string, "brand": string|null, "model": string|null, "category": string, "color": string|null, "material": string|null, "size": string|null, "era": string|null},
  "confidence": number 0-1,
  "identificationNotes": string,
  "condition": "new"|"like_new"|"good"|"fair"|"poor",
  "conditionNotes": string,
  "price": {"currency": string, "low": number, "high": number, "suggested": number, "quickSale": number, "demand": "low"|"medium"|"high", "reasoning": string},
  "comparables": [{"title": string, "price": number, "currency": string, "source": string, "url": null, "sold": boolean}],
  "title": string,
  "description": string,
  "platforms": {"ebay": {"title": string, "description": string}, "facebook": {"title": string, "description": string}, "vinted": {"title": string, "description": string}},
  "tags": [string],
  "attributes": [{"name": string, "value": string}],
  "crops": [{"photo": number, "x": number, "y": number, "w": number, "h": number}],
  "photoTips": [string],
  "shipping": {"weightKg": number, "packageSize": "small"|"medium"|"large"}
}`;

function prompt(n: number, s: Settings, note?: string, textOnly = false, evidence = "") {
  const what = textOnly
    ? `Someone wants to sell ONE item second-hand on eBay, Facebook Marketplace and Vinted. You can't see their photos; work from the seller's description below and assume normal used condition unless it says otherwise.`
    : `The ${n} attached photo(s) show ONE item someone wants to sell second-hand on eBay, Facebook Marketplace and Vinted.`;
  return `You are an expert resale appraiser. ${what}
Seller location: ${s.country}. Currency: ${s.currency}. Write all buyer-facing text in ${s.language}.${note ? `\nSeller's note: """${note}"""` : ""}

1. Identify the exact item (brand, model, variant, size, generation). Judge condition honestly from what is visible.
${
    evidence
      ? `2. Price it from these LIVE SEARCH RESULTS (raw JSON from Google Shopping and a web search, run just now; may be noisy or partly off-topic):
<<<
${evidence}
>>>
Google Shopping prices are mostly NEW retail prices: a used item usually sells for 40-70% of new (less for worn, more for collectible or sealed-new). Web results may show used listings (bazaars, Vinted, eBay, Aukro): prefer those for the second-hand price. Convert other currencies to ${s.currency}. "comparables": 2-5 REAL items from the results with their real url, price and source; sold=false unless clearly sold. In price.reasoning say briefly what the price is based on (e.g. "new in shops ~X, used listings ~Y").`
      : `2. Estimate today's typical SECOND-HAND prices in ${s.country} from your knowledge of the market (you cannot browse, so say in price.reasoning that it's an estimate). "comparables": 2-4 typical listing examples with realistic prices, source = the marketplace name, url null.`
  }
3. Write the listings. eBay: title max 80 chars, keyword-dense, description with short sections and bullets. Facebook: short friendly title, 3-6 conversational lines, mention pickup or shipping. Vinted: title max 60 chars, casual text ending with 3-6 hashtags. Never invent accessories or flaws you can't see.
4. crops: for every photo (0-based) a tight bounding box around the item, normalized 0-1.
Prices are plain numbers in ${s.currency}, rounded like real prices.
${PRICING_RULES}

Reply with only one JSON object of this shape:
${SHAPE}`;
}

/** Fills gaps so a slightly-off answer still becomes a usable listing. */
function normalize(raw: Record<string, unknown>, photoCount: number, s: Settings): Analysis {
  const r = raw as Partial<Analysis> & Record<string, never>;
  const item = { name: "Item", brand: null, model: null, category: "Other", color: null, material: null, size: null, era: null, ...(r.item ?? {}) };
  const title = String(r.title ?? item.name).slice(0, 120);
  const description = String(r.description ?? "");
  const copy = (p: "ebay" | "facebook" | "vinted") => ({ title: r.platforms?.[p]?.title ?? title, description: r.platforms?.[p]?.description ?? description });
  const price = r.price ?? ({} as Analysis["price"]);
  const suggested = Number(price.suggested) || 0;
  const a: Analysis = {
    item,
    confidence: Math.max(0, Math.min(1, Number(r.confidence ?? 0.7))),
    identificationNotes: String(r.identificationNotes ?? ""),
    condition: CONDITIONS.includes(r.condition as never) ? (r.condition as Analysis["condition"]) : "good",
    conditionNotes: String(r.conditionNotes ?? ""),
    price: {
      currency: s.currency,
      low: Number(price.low) || Math.round(suggested * 0.8),
      high: Number(price.high) || Math.round(suggested * 1.2),
      suggested,
      quickSale: Number(price.quickSale) || Math.round(suggested * 0.88),
      demand: ["low", "medium", "high"].includes(price.demand) ? price.demand : "medium",
      reasoning: String(price.reasoning ?? "Estimated from typical second-hand prices."),
    },
    comparables: Array.isArray(r.comparables)
      ? r.comparables.slice(0, 6).map((c) => ({ ...c, currency: c.currency || s.currency, url: typeof c.url === "string" && /^https:\/\//.test(c.url) ? c.url : null }))
      : [],
    title,
    description,
    platforms: { ebay: copy("ebay"), facebook: copy("facebook"), vinted: copy("vinted") },
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    attributes: Array.isArray(r.attributes) ? r.attributes : [],
    crops: Array.isArray(r.crops) && r.crops.length ? r.crops : Array.from({ length: photoCount }, (_, photo) => ({ photo, x: 0.05, y: 0.05, w: 0.9, h: 0.9 })),
    photoTips: Array.isArray(r.photoTips) ? r.photoTips.map(String).slice(0, 3) : [],
    shipping: { weightKg: Number(r.shipping?.weightKg) || 1, packageSize: r.shipping?.packageSize ?? "medium" },
  };
  const checked = AnalysisSchema.safeParse(a);
  if (!checked.success) throw new Error("Claude's answer was incomplete. Please try again.");
  return checked.data;
}

const LANG: Record<string, string> = { English: "en", Czech: "cs", Slovak: "sk", German: "de", French: "fr", Spanish: "es", Italian: "it", Dutch: "nl", Polish: "pl" };
const USED: Record<string, string> = { cs: "bazar cena", sk: "bazár cena", de: "gebraucht Preis", fr: "occasion prix", es: "segunda mano precio", it: "usato prezzo", nl: "tweedehands prijs", pl: "używany cena", en: "used price" };

/**
 * Live prices through the viewer's Composio connector (Google Shopping + web search, no account
 * needed). Returns "" when it isn't connected, isn't allowed, or fails: pricing then falls back
 * to Claude's own estimate.
 */
async function liveSearch(query: string, s: Settings, emit: (e: AnalyzeEvent) => void): Promise<string> {
  if (!mcp || !query) return "";
  const gl = (REGIONS.find((r) => r.country === s.country)?.code ?? "us").toLowerCase();
  const hl = LANG[s.language] ?? "en";
  const webQuery = `${query} ${USED[hl] ?? USED.en}`;
  emit({ type: "search", query });
  emit({ type: "search", query: webQuery });
  try {
    const res = await mcp.callTool("composio", "COMPOSIO_MULTI_EXECUTE_TOOL", {
      tools: [
        { tool_slug: "COMPOSIO_SEARCH_SHOPPING", arguments: { query, gl, hl } },
        { tool_slug: "COMPOSIO_SEARCH_WEB", arguments: { query: webQuery } },
      ],
      sync_response_to_workbench: false,
      thought: "Look up current new and second-hand prices for an item the user is selling.",
    });
    const text = JSON.stringify(res.payload ?? res);
    // Drop base64 thumbnails and keep the evidence small enough for the prompt.
    return text.replace(/"(thumbnail|serpapi_thumbnail|image)"\s*:\s*"[^"]*"/g, "").slice(0, 24000);
  } catch {
    return "";
  }
}

/** Thrown when this view can't send photos to Claude: the app then asks what the item is. */
class NeedsDescription extends Error {}

const SAMPLE_ERRORS: Record<string, string> = {
  not_granted: "SnapSell needs your OK to use Claude. Try again and choose Allow.",
  rate_limited: "Claude is busy or your usage limit is reached. Try again in a little while.",
  images_unavailable: "Photos can't be sent to Claude in this view. Open SnapSell on claude.ai.",
  image_rejected: "One of the photos couldn't be read. Try a different photo.",
  refused: "Claude couldn't help with this item.",
  invalid_json: "Claude's answer couldn't be read. Please try again.",
  session_expired: "Please sign in to Claude again.",
};

async function analyzeWithClaude(files: File[], s: Settings, note: string | undefined, emit: (e: AnalyzeEvent) => void, textOnly: boolean) {
  // Some Claude apps report no image support; try anyway and only fall back if the call refuses.
  const limits = await sample!.limits().catch(() => ({}) as { images?: { maxCount: number } });
  const images = textOnly ? [] : files.slice(0, limits.images?.maxCount ?? 4);
  emit({ type: "stage", stage: "looking" });
  let wrote = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 1. Quick identification, only to know what to search for.
    let evidence = "";
    if (mcp) {
      const id = await sample!.json<{ query?: string; name?: string }>(
        `${textOnly ? `A seller describes an item as: """${note ?? ""}"""` : `The attached photo(s) show one item for sale.${note ? ` Seller's note: """${note}"""` : ""}`}
Identify the exact product. Reply with only JSON: {"name": "full product name", "query": "short web-shop search query for this exact product (brand + model + key spec)"}`,
        { ...(images.length ? { images } : {}), modelTier: "quick", cache: false },
      );
      if (id?.name) emit({ type: "lens", matches: 0, bestGuess: String(id.name) });
      // 2. Live prices from Google Shopping and the web.
      emit({ type: "stage", stage: "searching" });
      evidence = await liveSearch(String(id?.query ?? id?.name ?? "").slice(0, 120), s, emit);
    }
    // 3. The full listing, priced from the live results when there are any.
    emit({ type: "stage", stage: "pricing" });
    timer = setTimeout(() => !wrote && emit({ type: "stage", stage: "pricing" }), 6000);
    const raw = await sample!.json<Record<string, unknown>>(prompt(images.length, s, note, textOnly, evidence), {
      ...(images.length ? { images } : {}),
      cache: false,
      onText: () => {
        if (!wrote) emit({ type: "stage", stage: "writing" });
        wrote = true;
      },
    });
    return normalize(raw, files.length, s);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (!textOnly && (code === "images_unavailable" || code === "image_rejected" || code === "capability_disabled")) throw new NeedsDescription();
    throw new Error(SAMPLE_ERRORS[code ?? ""] ?? (e instanceof Error ? e.message : "Claude couldn't finish. Please try again."));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function analyzeStream(form: FormData) {
  const files = form.getAll("photos").filter((f): f is File => f instanceof File).slice(0, 12);
  const condition = sellerCondition(form);
  const note = noteWithCondition((form.get("note") as string | null)?.trim() || undefined, condition);
  const textOnly = form.get("textOnly") === "1";
  const now = new Date().toISOString();
  const l: Listing = { id: id8(), owner: ME.email, createdAt: now, updatedAt: now, status: "analyzing", note, photos: [], enhanced: [], edits: {}, publish: {} };
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (e: AnalyzeEvent | { type: "listing"; listing: Listing }) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      // Upload photos while Claude looks at them.
      const uploads = Promise.all(files.map(storePhoto));
      try {
        const analysis = sample ? await analyzeWithClaude(files, settings, note, send, textOnly) : await demoAnalysis(files.length, settings, send);
        l.photos = await uploads;
        l.analysis = finalizeAnalysis(analysis, condition);
        l.status = "draft";
        await saveListing(l);
        send({ type: "stage", stage: "done" });
        send({ type: "listing", listing: l });
      } catch (e) {
        // Nothing is saved for a failed attempt: remove its uploaded photos again.
        for (const id of await uploads.catch(() => [] as string[])) if (!id.startsWith("local-")) void assets?.delete(id).catch(() => {});
        if (e instanceof NeedsDescription) send({ type: "error", message: "What is it?", code: "needs_description" });
        else send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
      ctrl.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

// ---------------------------------------------------------------- API

const platforms: PlatformStatus[] = (["ebay", "facebook", "vinted"] as const).map((platform) => ({
  platform,
  mode: platform === "ebay" ? "api" : "extension",
  connected: false,
  unavailable: true,
  detail: "Copy the text here, then paste it on the site",
}));

async function handle(path: string, method: string, init?: RequestInit): Promise<Response> {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  let m: RegExpMatchArray | null;

  if ((m = path.match(/^\/photos\/[^/]+\/([^/]+)$/))) {
    const blob = await photoBlob(m[1]);
    return blob ? new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg" } }) : new Response("", { status: 404 });
  }
  if (path === "/api/health") {
    return json({ ai: Boolean(sample), demo: !sample, hosted: true, gemini: false, claude: Boolean(sample), model: "claude", googleLogin: false, lens: { vision: false, serpapi: false }, ebayApp: false });
  }
  if (path === "/api/me") return json(ME);
  if (path === "/auth/logout") return json({ ok: true });
  if (path === "/api/settings") {
    if (method === "PUT") {
      settings = { ...settings, ...body };
      await saveSettings();
    }
    return json(settings);
  }
  if (path === "/api/platforms") return json(platforms);
  if (path === "/api/extension") return json({ online: false, paired: false, sites: {} });
  if (path === "/api/analyze") return analyzeStream(init!.body as FormData);
  if (path === "/api/listings") return json([...listings.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

  if ((m = path.match(/^\/api\/listings\/(\w+)(?:\/(\w+))?$/))) {
    const l = listings.get(m[1]);
    if (!l) return json({ error: "Not found" }, 404);
    const sub = m[2];
    if (!sub && method === "GET") return json(l);
    if (!sub && method === "DELETE") {
      listings.delete(l.id);
      await db?.doc(`listings/${l.id}`).delete().catch(() => {});
      for (const id of [...l.photos, ...l.enhanced]) if (!id.startsWith("local-")) await assets?.delete(id).catch(() => {});
      return json({ ok: true });
    }
    if (!sub && method === "PATCH") {
      if (body.edits) l.edits = { ...l.edits, ...body.edits };
      if (body.status) {
        if (body.status === "sold" && l.status !== "sold") l.soldAt = new Date().toISOString();
        if (body.status !== "sold") delete l.soldAt;
        l.status = body.status;
      }
      await saveListing(l);
      return json(l);
    }
    if (sub === "photo-plan" && method === "POST") {
      if (!sample) return json({ error: "Claude isn't available on this page right now." }, 400);
      const limits = await sample.limits().catch(() => ({}) as { images?: { maxCount: number } });
      if (!limits.images) return json({ error: "Photos can't be sent to Claude in this view. Try Auto or White." }, 400);
      const name = l.photos[Number(body?.photo ?? 0)] ?? l.photos[0];
      const blob = await photoBlob(name);
      if (!blob) return json({ error: "Photo not found" }, 404);
      try {
        const small = new File([await prepareForUpload(blob, 1024)], "photo.jpg", { type: "image/jpeg" });
        const shape = JSON.stringify(photoPlanJsonSchema);
        const raw = await sample.json(`${photoPlanPrompt(settings.language)}\nJSON shape (JSON Schema): ${shape}`, { images: [small], modelTier: "quick", cache: false });
        return json(normalizePhotoPlan(raw));
      } catch (e) {
        return json({ error: (e as { message?: string })?.message ?? String(e) }, 502);
      }
    }
    if (sub === "assistant" && method === "POST") {
      if (!sample || !l.analysis) return json({ error: "Claude isn't available on this page right now." }, 400);
      try {
        const ask = assistantPrompt(l, settings, body?.history ?? [], String(body?.text ?? ""), body?.language);
        const r = parseAssistantReply(await sample.json(ask, { modelTier: "default", cache: false }));
        l.edits = applyAssistantChanges(l, r.changes);
        await saveListing(l);
        return json({ reply: r.reply, changes: r.changes, listing: l });
      } catch (e) {
        return json({ error: (e as { message?: string })?.message ?? String(e) }, 502);
      }
    }
    if (sub === "enhanced") {
      const files = (init!.body as FormData).getAll("photos").filter((f): f is File => f instanceof File);
      const old = l.enhanced;
      l.enhanced = await Promise.all(files.map(storePhoto));
      await saveListing(l);
      for (const id of old) if (!id.startsWith("local-")) void assets?.delete(id).catch(() => {});
      return json(l);
    }
    if (sub === "publish") return json(l);
  }
  return json({ error: `Not available on this page: ${path}` }, 404);
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  const m = url.pathname.match(/\/(api|photos|auth)\/.*$/);
  if (!m || url.origin !== location.origin) return realFetch(input, init);
  return handle(m[0], (init?.method ?? "GET").toUpperCase(), init);
};

// Load saved settings and listings before the app starts.
if (db) {
  try {
    const [s, all] = await Promise.all([db.doc("settings/main").get(), db.collection("listings").get()]);
    if (s.exists) settings = { ...settings, ...(s.data() as Partial<Settings>) };
    for (const d of all.docs) {
      const l = d.data() as Listing | undefined;
      if (l?.id) listings.set(l.id, l);
    }
  } catch {
    // database unavailable: start empty for this visit
  }
}
