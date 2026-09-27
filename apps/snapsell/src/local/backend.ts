/**
 * SnapSell without a server. Only bundled in `vite build --mode standalone` (the GitHub Pages version).
 * Answers the app's /api, /photos and /auth requests inside the page:
 * - listings, settings and photos are kept on this device (IndexedDB),
 * - the AI is Google Gemini, called directly with the user's own free key,
 * - Facebook/Vinted posts go to the SnapSell Chrome extension when it's on this computer.
 * eBay has no browser-friendly API, so it's copy & open here (automatic in the server version).
 */
import { extractGeminiKey } from "../lib/geminiKey.ts";
import { demoAnalysis } from "../../server/ai/demo.ts";
import { applyAssistantChanges, assistantPrompt, parseAssistantReply } from "../../shared/assistant.ts";
import { geminiAnalyze, geminiAssistant } from "../../shared/gemini.ts";
import {
  DEFAULT_SETTINGS,
  PLATFORMS,
  effectiveCondition,
  effectiveCopy,
  effectivePrice,
  type AnalyzeEvent,
  type ExtJob,
  type Listing,
  type Platform,
  type PlatformStatus,
  type Settings,
} from "../../shared/types.ts";
import { photoResolver } from "../lib/api.ts";
import { idb } from "./idb.ts";

const ME = { email: "you@this-device", name: "You", authEnabled: false };
const photos = new Map<string, Blob>(); // "<id>/<name>"
const urls = new Map<string, string>();
let listings = new Map<string, Listing>();
let settings: Settings = { ...DEFAULT_SETTINGS };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const id8 = () => Math.random().toString(36).slice(2, 10);
const saveListings = () => idb.set("listings", [...listings.values()]).catch(() => {});
const saveSettings = () => idb.set("settings", settings).catch(() => {});

async function putPhoto(id: string, name: string, blob: Blob) {
  const key = `${id}/${name}`;
  photos.set(key, blob);
  urls.set(key, URL.createObjectURL(blob));
  await idb.set(`photo:${key}`, blob).catch(() => {});
}

async function dropPhotos(id: string) {
  for (const key of [...photos.keys()].filter((k) => k.startsWith(`${id}/`))) {
    photos.delete(key);
    URL.revokeObjectURL(urls.get(key)!);
    urls.delete(key);
    await idb.del(`photo:${key}`).catch(() => {});
  }
}

photoResolver.resolve = (path) => urls.get(path.replace(/^.*\/photos\//, "")) ?? path;

// ---------------------------------------------------------------- Chrome extension bridge

// The extension's bridge script answers on this page (see extension/content/bridge.js).
type Ext = { sites: { facebook?: boolean; vinted?: boolean }; allowed: boolean };
let extension: Ext | null = null;
document.documentElement.dataset.snapsell = "app";
window.addEventListener("message", (e) => {
  const m = e.data as { snapsell?: string; type?: string } & Record<string, unknown>;
  if (e.source !== window || m?.snapsell !== "ext") return;
  if (m.type === "hello") extension = { sites: (m.sites as Ext["sites"]) ?? {}, allowed: Boolean(m.allowed) };
  if (m.type === "update") {
    const l = listings.get(m.listingId as string);
    const p = m.platform as Platform;
    if (!l) return;
    l.publish[p] = { status: m.status as never, message: m.message as string, url: m.url as string | undefined, updatedAt: new Date().toISOString() };
    if (m.status === "live") l.status = "live";
    void saveListings();
  }
});
const hello = () => window.postMessage({ snapsell: "page", type: "hello" }, location.origin);
hello();
setInterval(hello, 15_000);

async function sendToExtension(l: Listing, p: "facebook" | "vinted") {
  const a = l.analysis!;
  const copy = effectiveCopy(l, p);
  const names = l.photos.map((n, i) => l.enhanced[i] ?? n);
  const files = await Promise.all(
    names.map(async (n, i) => {
      const blob = photos.get(`${l.id}/${n}`)!;
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let j = 0; j < buf.length; j += 0x8000) bin += String.fromCharCode(...buf.subarray(j, j + 0x8000));
      return { name: `photo-${i + 1}.jpg`, type: blob.type || "image/jpeg", data: btoa(bin) };
    }),
  );
  const job: ExtJob = {
    listingId: l.id,
    platform: p,
    title: copy.title,
    description: copy.description,
    price: Math.round(effectivePrice(l)),
    currency: settings.currency,
    condition: effectiveCondition(l),
    category: a.item.category,
    brand: a.item.brand,
    size: a.item.size,
    photos: [],
    autoPublish: settings.autoPublish,
    vintedDomain: settings.vintedDomain,
  };
  window.postMessage({ snapsell: "page", type: "job", job, photos: files }, location.origin);
}

// ---------------------------------------------------------------- API

function platformStatuses(): PlatformStatus[] {
  const site = (p: "facebook" | "vinted", name: string): PlatformStatus => {
    if (!extension) return { platform: p, mode: "extension", connected: false, action: "install_extension", detail: "Automatic on your computer with SnapSell for Chrome" };
    if (!extension.allowed) return { platform: p, mode: "extension", connected: false, action: "install_extension", detail: "Allow this page in the SnapSell extension" };
    if (!extension.sites[p]) return { platform: p, mode: "extension", connected: false, action: "chrome_login", detail: `Log in to ${name} in this Chrome` };
    return { platform: p, mode: "extension", connected: true, detail: "Posted by SnapSell for Chrome on this computer" };
  };
  return [
    { platform: "ebay", mode: "api", connected: false, unavailable: true, detail: "Copy & open here · automatic in the server version" },
    site("facebook", "Facebook"),
    site("vinted", "Vinted"),
  ];
}

function analyzeStream(form: FormData) {
  const files = form.getAll("photos").filter((f): f is File => f instanceof File);
  const note = (form.get("note") as string | null)?.trim() || undefined;
  const now = new Date().toISOString();
  const l: Listing = { id: id8(), owner: ME.email, createdAt: now, updatedAt: now, status: "analyzing", note, photos: [], enhanced: [], edits: {}, publish: {} };
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (e: AnalyzeEvent | { type: "listing"; listing: Listing }) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      for (const [i, f] of files.slice(0, 12).entries()) {
        await putPhoto(l.id, `photo-${i}.jpeg`, f);
        l.photos.push(`photo-${i}.jpeg`);
      }
      listings.set(l.id, l);
      await saveListings();
      send({ type: "listing", listing: l });
      try {
        l.analysis = settings.geminiApiKey
          ? await geminiAnalyze(
              { apiKey: settings.geminiApiKey },
              await Promise.all(files.slice(0, 12).map(async (f) => ({ mediaType: f.type || "image/jpeg", base64: await toBase64(f) }))),
              settings,
              note,
              send,
            )
          : await demoAnalysis(l.photos.length, settings, send);
        l.status = "draft";
        send({ type: "stage", stage: "done" });
        send({ type: "listing", listing: l });
      } catch (e) {
        l.status = "failed";
        l.error = e instanceof Error ? e.message : String(e);
        send({ type: "error", message: l.error });
      }
      await saveListings();
      ctrl.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function handle(path: string, method: string, init?: RequestInit): Promise<Response> {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  let m: RegExpMatchArray | null;

  if (path.startsWith("/photos/")) {
    const blob = photos.get(path.slice("/photos/".length));
    return blob ? new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg" } }) : new Response("", { status: 404 });
  }
  if (path === "/api/health") {
    const ai = Boolean(settings.geminiApiKey);
    return json({ ai, demo: !ai, local: true, extension: Boolean(extension), gemini: ai, claude: false, model: "gemini", googleLogin: false, lens: { vision: false, serpapi: false }, ebayApp: false });
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
  if (path === "/api/platforms") return json(platformStatuses());
  if (path === "/api/extension") return json({ online: Boolean(extension), paired: Boolean(extension?.allowed), sites: extension?.sites ?? {} });
  if (path === "/api/analyze") return analyzeStream(init!.body as FormData);
  if (path === "/api/listings") return json([...listings.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

  if ((m = path.match(/^\/api\/listings\/(\w+)(?:\/(\w+))?$/))) {
    const l = listings.get(m[1]);
    if (!l) return json({ error: "Not found" }, 404);
    const sub = m[2];
    if (!sub && method === "GET") return json(l);
    if (!sub && method === "DELETE") {
      listings.delete(l.id);
      await dropPhotos(l.id);
      await saveListings();
      return json({ ok: true });
    }
    if (!sub && method === "PATCH") {
      if (body.edits) l.edits = { ...l.edits, ...body.edits };
      if (body.status) {
        if (body.status === "sold" && l.status !== "sold") l.soldAt = new Date().toISOString();
        if (body.status !== "sold") delete l.soldAt;
        l.status = body.status;
      }
      l.updatedAt = new Date().toISOString();
      await saveListings();
      return json(l);
    }
    if (sub === "assistant" && method === "POST") {
      if (!settings.geminiApiKey || !l.analysis) return json({ error: "The voice assistant needs your Gemini key (Connections)." }, 400);
      try {
        const ask = assistantPrompt(l, settings, body?.history ?? [], String(body?.text ?? ""), body?.language);
        const r = parseAssistantReply(await geminiAssistant({ apiKey: settings.geminiApiKey }, ask));
        l.edits = applyAssistantChanges(l, r.changes);
        l.updatedAt = new Date().toISOString();
        await saveListings();
        return json({ reply: r.reply, changes: r.changes, listing: l });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }
    if (sub === "enhanced") {
      const stamp = Date.now().toString(36);
      const files = (init!.body as FormData).getAll("photos").filter((f): f is File => f instanceof File);
      // Remove the previous enhanced set, keep the originals.
      for (const old of l.enhanced) {
        const key = `${l.id}/${old}`;
        photos.delete(key);
        urls.delete(key);
        await idb.del(`photo:${key}`).catch(() => {});
      }
      l.enhanced = [];
      for (const [i, f] of files.entries()) {
        const name = `enhanced-${i}-${stamp}.jpeg`;
        await putPhoto(l.id, name, f);
        l.enhanced.push(name);
      }
      await saveListings();
      return json(l);
    }
    if (sub === "publish") {
      const statuses = platformStatuses();
      for (const p of (body.platforms as Platform[]).filter((x) => PLATFORMS.includes(x))) {
        const st = statuses.find((s) => s.platform === p);
        if (p === "ebay" || !st?.connected) {
          l.publish[p] = { status: "error", message: "Use copy & open for this site on this device.", updatedAt: new Date().toISOString() };
          continue;
        }
        l.publish[p] = { status: "working", message: "Sent to SnapSell for Chrome", updatedAt: new Date().toISOString() };
        void sendToExtension(l, p as "facebook" | "vinted");
      }
      await saveListings();
      return json(l);
    }
  }
  return json({ error: `Needs the server version: ${path}` }, 404);
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  const m = url.pathname.match(/\/(api|photos|auth)\/.*$/);
  if (!m || url.origin !== location.origin) return realFetch(input, init);
  return handle(m[0], (init?.method ?? "GET").toUpperCase(), init);
};

// Load everything saved on this device before the app starts.
try {
  const [savedSettings, savedListings, keys] = await Promise.all([idb.get<Settings>("settings"), idb.get<Listing[]>("listings"), idb.keys()]);
  if (savedSettings) settings = { ...settings, ...savedSettings };
  listings = new Map((savedListings ?? []).map((l) => [l.id, l]));
  for (const k of keys.map(String).filter((k) => k.startsWith("photo:"))) {
    const blob = await idb.get<Blob>(k);
    if (blob) {
      const key = k.slice("photo:".length);
      photos.set(key, blob);
      urls.set(key, URL.createObjectURL(blob));
    }
  }
  // Personal setup link (…/#gemini=KEY): saves the Gemini key on this phone so nobody has to type
  // it. The key lives only in the link the owner sends, never in the published site.
  const key = extractGeminiKey(location.hash);
  if (key) {
    settings = { ...settings, geminiApiKey: key, aiProvider: "gemini" };
    await saveSettings();
    history.replaceState(null, "", `${location.pathname}${location.search}#/`);
  }
  // Ask the browser not to clear SnapSell's data when space runs low.
  void navigator.storage?.persist?.();
} catch {
  // Storage unavailable (private window): works for this visit only.
}
