import { GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import { AnalysisSchema, type Analysis, type AnalyzeEvent, type Settings } from "./types.ts";

/**
 * Google Gemini analysis (free plan, no card) with Google Search grounding for prices.
 * Same two steps as the Claude path: research with search, then a structured listing.
 * Browser-safe: used by the server and by the no-server version running on the phone.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

export type GeminiPhoto = { mediaType: string; base64: string };
export type GeminiOptions = { apiKey: string; model?: string };

const RESEARCH = `You are an expert resale appraiser helping someone sell a used item on eBay, Facebook Marketplace and Vinted.
Identify the exact item in the photos (brand, model, variant, size, generation) and judge its condition honestly from what is visible.
Use Google Search to find current second-hand prices, preferring SOLD listings in the seller's country; note asking prices separately.
Finish with a concise report: identification and confidence, condition, comparable listings (title, price, currency, site, URL, sold or asking) and a price recommendation (low / high / suggested / quick sale) with reasoning.`;

const COMPOSE = `Turn the appraiser's report and the photos into a ready-to-post listing as JSON.
Be accurate and honest: mention visible flaws, never invent accessories, specs or authenticity.
eBay: title max 80 characters, keyword-dense; description with short sections and bullet points.
Facebook Marketplace: short friendly title; 3-6 short conversational lines, mention pickup or shipping.
Vinted: title max 60 characters; casual description ending with 3-6 hashtags.
Prices are plain numbers in the seller's currency, rounded like real prices.
crops: for every photo a tight bounding box around the item, normalized 0-1.`;

// Gemini accepts standard JSON Schema; drop the $schema marker it doesn't need.
const { $schema: _drop, ...analysisJsonSchema } = z.toJSONSchema(AnalysisSchema) as Record<string, unknown>;

/** Gemini errors arrive as raw JSON text; turn them into one readable sentence. */
function friendly(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e);
  let msg = raw;
  try {
    msg = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? raw;
  } catch {
    // not JSON: keep as is
  }
  if (/API key not valid/i.test(msg)) return new Error("The Gemini API key isn't valid. Check it in Connections (or GEMINI_API_KEY on the server).");
  if (/quota|RESOURCE_EXHAUSTED|rate/i.test(msg)) return new Error("Gemini's free plan limit is reached for now. Try again in a minute (or tomorrow).");
  return new Error(`Gemini: ${msg.split("\n")[0].slice(0, 200)}`);
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
  const research = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [...images, { text: `${context}\n\nIdentify this item and research what it sells for.` }] }],
    config: { systemInstruction: RESEARCH, tools: [{ googleSearch: {} }] },
  });
  const grounding = research.candidates?.[0]?.groundingMetadata;
  for (const q of grounding?.webSearchQueries ?? []) emit({ type: "search", query: q });
  for (const c of (grounding?.groundingChunks ?? []).slice(0, 6)) {
    if (c.web?.uri) emit({ type: "source", title: c.web.title ?? c.web.uri, url: c.web.uri });
  }

  emit({ type: "stage", stage: "pricing" });
  emit({ type: "stage", stage: "writing" });
  const composed = await ai.models.generateContent({
    model,
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
  });
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
