import { z } from "zod";

/**
 * "AI Magic" photo edit: the AI looks at the photo and decides the edit (straighten, crop, light,
 * colour, background); the phone then applies it locally. Free: it's a text answer, not a generated
 * image, so it works on Gemini's free plan and on Claude.
 */
export const PhotoPlanSchema = z.object({
  rotate: z.number().describe("Degrees to rotate so the item stands straight (-15 to 15, 0 if already straight). Positive = clockwise."),
  crop: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .describe("Box around the item with a little breathing room, in 0-1 fractions of the ORIGINAL photo (x,y = top-left)."),
  exposure: z.number().describe("-1 to 1: brighten (positive) or darken (negative). Most indoor phone photos need +0.2 to +0.5."),
  contrast: z.number().describe("-1 to 1."),
  warmth: z.number().describe("-1 to 1: positive = warmer (fix blue shade), negative = cooler (fix yellow bulbs)."),
  saturation: z.number().describe("-1 to 1. Keep colours true to the real item; small values."),
  shadows: z.number().describe("0 to 1: how much to lift dark areas."),
  highlights: z.number().describe("0 to 1: how much to recover blown-out bright areas."),
  background: z.enum(["keep", "white"]).describe("'white' when a clean white backdrop would sell better (small products, messy or distracting background); 'keep' for clothes on a hanger, furniture, cars, or nice settings."),
  reason: z.string().describe("One short sentence about what you fixed, in the seller's language."),
});
export type PhotoPlan = z.infer<typeof PhotoPlanSchema>;

const { $schema: _drop, ...schema } = z.toJSONSchema(PhotoPlanSchema) as Record<string, unknown>;
export const photoPlanJsonSchema = schema;

export function photoPlanPrompt(language: string) {
  return `You are a product photo retoucher for second-hand marketplace listings (Vinted, eBay, Facebook Marketplace).
Look at this photo and decide the best edit so the item looks clear, bright and true to life. Never change the item itself.
Be moderate: buyers must see the real colour and condition. Answer only with the JSON. Write "reason" in ${language}.`;
}

const clamp = (v: unknown, lo: number, hi: number, fallback = 0) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};

/** Makes any model answer safe to apply: numbers in range, a sane crop, a known background. */
export function normalizePhotoPlan(raw: unknown): PhotoPlan {
  let v = raw;
  if (typeof v === "string") {
    const m = /\{[\s\S]*\}/.exec(v);
    try {
      v = m ? JSON.parse(m[0]) : {};
    } catch {
      v = {};
    }
  }
  const o = (v ?? {}) as Partial<Record<keyof PhotoPlan, unknown>> & { crop?: Partial<Record<"x" | "y" | "w" | "h", unknown>> };
  let x = clamp(o.crop?.x, 0, 1);
  let y = clamp(o.crop?.y, 0, 1);
  let w = clamp(o.crop?.w, 0, 1, 1);
  let h = clamp(o.crop?.h, 0, 1, 1);
  // A crop that is tiny or falls off the photo is ignored (keep the whole photo).
  if (w < 0.15 || h < 0.15 || x + w > 1.02 || y + h > 1.02) [x, y, w, h] = [0, 0, 1, 1];
  return {
    rotate: clamp(o.rotate, -15, 15),
    crop: { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) },
    exposure: clamp(o.exposure, -1, 1),
    contrast: clamp(o.contrast, -1, 1),
    warmth: clamp(o.warmth, -1, 1),
    saturation: clamp(o.saturation, -1, 1),
    shadows: clamp(o.shadows, 0, 1),
    highlights: clamp(o.highlights, 0, 1),
    background: o.background === "white" ? "white" : "keep",
    reason: typeof o.reason === "string" ? o.reason.slice(0, 200) : "",
  };
}
