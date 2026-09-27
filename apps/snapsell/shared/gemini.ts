import { GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import { assistantJsonSchema } from "./assistant.ts";
import { PRICING_RULES } from "./pricing.ts";
import { photoPlanJsonSchema } from "./photoPlan.ts";
import { AnalysisSchema, type Analysis, type AnalyzeEvent, type Settings } from "./types.ts";

/**
 * Google Gemini analysis (free plan, no card) with Google Search grounding for prices.
 * Same two steps as the Claude path: research with search, then a structured listing.
 * Browser-safe: used by the server and by the no-server version running on the phone.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
/** Tried in order when a model is busy (503) or retired (404). */
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"];

export type GeminiPhoto = { mediaType: string; base64: string };
export type GeminiOptions = { apiKey: string; model?: string };

const RESEARCH = `You are an expert resale appraiser helping someone sell a used item on eBay, Facebook Marketplace and Vinted.
Identify the exact item in the photos (brand, model, variant, size, generation) and judge its condition honestly from what is visible.
Use Google Search to find current second-hand prices, preferring SOLD listings in the seller's country; note asking prices separately.
Finish with a concise report: identification and confidence, condition, comparable listings (title, price, currency, site, URL, sold or asking) and a price recommendation (low / high / suggested / quick sale) with reasoning.
${PRICING_RULES}`;

const COMPOSE = `Turn the appraiser's report and the photos into a ready-to-post listing as JSON.
Be accurate and honest: mention visible flaws, never invent accessories, specs or authenticity.
eBay: title max 80 characters, keyword-dense; description with short sections and bullet points.
Facebook Marketplace: short friendly title; 3-6 short conversational lines, mention pickup or shipping.
Vinted: title max 60 characters; casual description ending with 3-6 hashtags.
Prices are plain numbers in the seller's currency, rounded like real prices.
crops: for every photo a tight bounding box around the item, normalized 0-1.`;

// Gemini accepts standard JSON Schema; drop the $schema marker it doesn't need.
const { $schema: _drop, ...analysisJsonSchema } = z.toJSONSchema(AnalysisSchema) as Record<string, unknown>;

type GeminiFailure = { code?: number; status?: string; message: string };

/** Gemini errors arrive as raw JSON text in the error message; read code, status and message. */
function failure(e: unknown): GeminiFailure {
  const raw = e instanceof Error ? e.message : String(e);
  try {
    const err = (JSON.parse(raw) as { error?: GeminiFailure }).error;
    if (err) return err;
  } catch {
    // not JSON
  }
  const code = Number((e as { status?: number }).status) || undefined;
  return { code, message: raw };
}

const busy = (f: GeminiFailure) => f.code === 503 || f.code === 404 || f.status === "UNAVAILABLE" || f.status === "NOT_FOUND";
const overQuota = (f: GeminiFailure) => f.code === 429 || f.status === "RESOURCE_EXHAUSTED";

function friendly(e: unknown): Error {
  const f = failure(e);
  if (/API key not valid/i.test(f.message) || f.status === "INVALID_ARGUMENT" && /key/i.test(f.message)) {
    return new Error("The Gemini API key isn't valid. Check it in Connections (or GEMINI_API_KEY on the server).");
  }
  if (overQuota(f)) return new Error("Gemini's free plan limit is reached for now. Try again in a few minutes (or tomorrow).");
  if (busy(f)) return new Error("Gemini is very busy right now. Try again in a minute.");
  return new Error(`Gemini: ${f.message.split("\n")[0].slice(0, 200)}`);
}

/** Runs one request, moving to the next model while Google reports a model busy or retired. */
async function withModels<T>(first: string, run: (model: string) => Promise<T>): Promise<T> {
  const models = [first, ...FALLBACK_MODELS.filter((m) => m !== first)];
  let last: unknown;
  for (const m of models) {
    try {
      return await run(m);
    } catch (e) {
      last = e;
      if (!busy(failure(e))) throw e;
    }
  }
  throw last;
}

export async function geminiAnalyze(...args: Parameters<typeof analyze>) {
  try {
    return await analyze(...args);
  } catch (e) {
    throw friendly(e);
  }
}

async function analyze(
  opts: GeminiOptions,
  photos: GeminiPhoto[],
  settings: Settings,
  note: string | undefined,
  emit: (e: AnalyzeEvent) => void,
  visual?: string,
): Promise<Analysis> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const model = opts.model || DEFAULT_GEMINI_MODEL;
  const images: Part[] = photos.flatMap((p, i) => [
    { text: `Photo ${i}:` },
    { inlineData: { mimeType: p.mediaType, data: p.base64 } },
  ]);
  const context = [
    `Seller location: ${settings.country}. Currency: ${settings.currency}.`,
    `Write all buyer-facing text in ${settings.language}.`,
    note ? `Seller's note about the item: """${note}"""` : "",
    visual ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  emit({ type: "stage", stage: "looking" });
  emit({ type: "stage", stage: "searching" });
  const researchParts = [...images, { text: `${context}\n\nIdentify this item and research what it sells for.` }];
  let research;
  try {
    research = await withModels(model, (m) =>
      ai.models.generateContent({
        model: m,
        contents: [{ role: "user", parts: researchParts }],
        config: { systemInstruction: RESEARCH, tools: [{ googleSearch: {} }] },
      }),
    );
  } catch (e) {
    // Google Search isn't in every free key's quota: fall back to the model's own market knowledge.
    if (!overQuota(failure(e))) throw e;
    research = await withModels(model, (m) =>
      ai.models.generateContent({
        model: m,
        contents: [{ role: "user", parts: [...researchParts, { text: "Web search is unavailable: estimate from your own knowledge and say so in the price reasoning." }] }],
        config: { systemInstruction: RESEARCH },
      }),
    );
  }
  const grounding = research.candidates?.[0]?.groundingMetadata;
  for (const q of grounding?.webSearchQueries ?? []) emit({ type: "search", query: q });
  for (const c of (grounding?.groundingChunks ?? []).slice(0, 6)) {
    if (c.web?.uri) emit({ type: "source", title: c.web.title ?? c.web.uri, url: c.web.uri });
  }

  emit({ type: "stage", stage: "pricing" });
  emit({ type: "stage", stage: "writing" });
  const composed = await withModels(model, (m) => ai.models.generateContent({
    model: m,
    contents: [
      {
        role: "user",
        parts: [
          ...images,
          {
            text: `${context}\n\nResearch report:\n${research.text?.trim() || "(no research available, estimate from your knowledge)"}\n\nThere are ${photos.length} photos. Produce the listing.`,
          },
        ],
      },
    ],
    config: { systemInstruction: COMPOSE, responseMimeType: "application/json", responseJsonSchema: analysisJsonSchema },
  }));
  let raw: unknown;
  try {
    raw = JSON.parse(composed.text ?? "");
  } catch {
    throw new Error("Gemini's answer couldn't be read. Please try again.");
  }
  const parsed = AnalysisSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Gemini's answer was incomplete. Please try again.");
  return parsed.data;
}

/** One turn of the voice assistant: a short spoken answer plus any listing changes, as JSON. */
export async function geminiAssistant(opts: GeminiOptions, prompt: string): Promise<unknown> {
  try {
    const ai = new GoogleGenAI({ apiKey: opts.apiKey });
    // Short chat turns: when one model's free quota is used up, a lighter model (own quota) answers instead.
    const models = [opts.model || DEFAULT_GEMINI_MODEL, ...FALLBACK_MODELS];
    let last: unknown;
    for (const m of [...new Set(models)]) {
      try {
        const res = await ai.models.generateContent({
          model: m,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { responseMimeType: "application/json", responseJsonSchema: assistantJsonSchema },
        });
        return JSON.parse(res.text ?? "{}");
      } catch (e) {
        last = e;
        const f = failure(e);
        if (!busy(f) && !overQuota(f)) throw e;
      }
    }
    throw last;
  } catch (e) {
    throw friendly(e);
  }
}

/** "AI Magic": Gemini looks at one photo and returns the edit to apply (see shared/photoPlan.ts). */
export async function geminiPhotoPlan(opts: GeminiOptions, photo: GeminiPhoto, prompt: string): Promise<unknown> {
  try {
    const ai = new GoogleGenAI({ apiKey: opts.apiKey });
    let last: unknown;
    for (const m of [...new Set([opts.model || DEFAULT_GEMINI_MODEL, ...FALLBACK_MODELS])]) {
      try {
        const res = await ai.models.generateContent({
          model: m,
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: photo.mediaType, data: photo.base64 } }, { text: prompt }] }],
          config: { responseMimeType: "application/json", responseJsonSchema: photoPlanJsonSchema },
        });
        return JSON.parse(res.text ?? "{}");
      } catch (e) {
        last = e;
        const f = failure(e);
        if (!busy(f) && !overQuota(f)) throw e;
      }
    }
    throw last;
  } catch (e) {
    throw friendly(e);
  }
}
