import { randomBytes } from "node:crypto";
import type { AnalyzeEvent, Settings } from "../../shared/types.ts";
import type { Photo } from "./analyze.ts";

/**
 * Visual search on the item's cover photo, like Google Lens, before the AI prices it:
 * - Google Cloud Vision "web detection" (GOOGLE_VISION_API_KEY): what the item is + pages showing it.
 * - SerpApi Google Lens (SERPAPI_KEY): real Lens visual matches, often with shop prices.
 * Both are optional; results are handed to the AI as extra evidence.
 */
export const visionEnabled = () => Boolean(process.env.GOOGLE_VISION_API_KEY);
export const serpEnabled = () => Boolean(process.env.SERPAPI_KEY);

const COUNTRY_CODE: Record<string, string> = {
  "United States": "us",
  "United Kingdom": "uk",
  Czechia: "cz",
  Slovakia: "sk",
  Germany: "de",
  Austria: "at",
  France: "fr",
  Spain: "es",
  Italy: "it",
  Netherlands: "nl",
  Poland: "pl",
};

// SerpApi fetches the image by URL, so the photo gets a short-lived, unguessable public link.
const publicPhotos = new Map<string, { id: string; name: string; expires: number }>();

export function publicPhoto(token: string) {
  const p = publicPhotos.get(token);
  if (!p || p.expires < Date.now()) {
    publicPhotos.delete(token);
    return undefined;
  }
  return p;
}

function sharePhoto(id: string, name: string) {
  const token = randomBytes(18).toString("base64url");
  publicPhotos.set(token, { id, name, expires: Date.now() + 10 * 60_000 });
  return token;
}

type Match = { title: string; url?: string; source?: string; price?: number; currency?: string };

async function vision(photo: Photo) {
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ image: { content: photo.data.toString("base64") }, features: [{ type: "WEB_DETECTION", maxResults: 15 }] }],
    }),
  });
  if (!res.ok) throw new Error(`Cloud Vision HTTP ${res.status}`);
  const json = (await res.json()) as {
    responses?: {
      webDetection?: {
        bestGuessLabels?: { label: string }[];
        webEntities?: { description?: string; score?: number }[];
        pagesWithMatchingImages?: { url: string; pageTitle?: string }[];
      };
    }[];
  };
  const w = json.responses?.[0]?.webDetection ?? {};
  return {
    bestGuess: w.bestGuessLabels?.[0]?.label,
    entities: (w.webEntities ?? []).filter((e) => e.description).slice(0, 8).map((e) => e.description!),
    matches: (w.pagesWithMatchingImages ?? []).slice(0, 10).map((p) => ({
      title: (p.pageTitle ?? p.url).replace(/<[^>]+>/g, ""),
      url: p.url,
    })) as Match[],
  };
}

async function serpLens(imageUrl: string, settings: Settings) {
  const params = new URLSearchParams({
    engine: "google_lens",
    url: imageUrl,
    api_key: process.env.SERPAPI_KEY!,
    country: COUNTRY_CODE[settings.country] ?? "us",
  });
  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}`);
  const json = (await res.json()) as {
    visual_matches?: { title: string; link?: string; source?: string; price?: { extracted_value?: number; currency?: string } }[];
  };
  return (json.visual_matches ?? []).slice(0, 15).map((m) => ({
    title: m.title,
    url: m.link,
    source: m.source,
    price: m.price?.extracted_value,
    currency: m.price?.currency,
  })) as Match[];
}

/**
 * Runs whichever visual searches are configured. Returns a text summary for the AI prompt,
 * or "" when none ran. Never throws: visual search is a bonus, not a requirement.
 */
export async function lensSearch(opts: {
  photo: Photo;
  listingId: string;
  photoName: string;
  origin: string;
  settings: Settings;
  emit: (e: AnalyzeEvent) => void;
}): Promise<string> {
  const { photo, listingId, photoName, origin, settings, emit } = opts;
  // SerpApi must be able to download the photo, which a localhost address doesn't allow.
  const publicOrigin = !/localhost|127\.0\.0\.1|\[::1\]/.test(origin);
  if (!visionEnabled() && !(serpEnabled() && publicOrigin)) return "";
  emit({ type: "stage", stage: "lens" });

  const [v, s] = await Promise.all([
    visionEnabled() ? vision(photo).catch((e) => (console.warn("vision", e), null)) : null,
    serpEnabled() && publicOrigin
      ? serpLens(`${origin}/p/${sharePhoto(listingId, photoName)}`, settings).catch((e) => (console.warn("serpapi", e), null))
      : null,
  ]);

  const matches = [...(s ?? []), ...(v?.matches ?? [])];
  emit({ type: "lens", matches: matches.length, bestGuess: v?.bestGuess ?? s?.[0]?.title });
  for (const m of s ?? []) {
    if (m.price) emit({ type: "price", value: m.price, currency: m.currency ?? "", source: m.source ?? "Google Lens" });
  }

  const lines: string[] = [];
  if (v?.bestGuess) lines.push(`Google best guess: ${v.bestGuess}`);
  if (v?.entities.length) lines.push(`Related entities: ${v.entities.join(", ")}`);
  for (const m of matches) {
    lines.push(`- ${m.title}${m.source ? ` (${m.source})` : ""}${m.price ? ` price ${m.price} ${m.currency ?? ""}` : ""}${m.url ? ` ${m.url}` : ""}`);
  }
  return lines.length ? `Visual search (Google Lens) results for the cover photo:\n${lines.join("\n")}` : "";
}
