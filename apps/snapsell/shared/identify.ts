import { z } from "zod";

/**
 * Quick first look: what is the item? Done before pricing so the seller can confirm or correct it
 * when the AI isn't sure, and the expensive price research then runs on the right item.
 */
export const IdentifySchema = z.object({
  name: z.string().describe("Most likely exact product name (brand, model, variant), e.g. 'Sony WH-1000XM4 headphones'"),
  category: z.string().describe("Broad category, e.g. 'Headphones', 'Sneakers'"),
  confidence: z.number().describe("0-1: how sure you are about the exact model, not just the kind of item"),
  alternatives: z.array(z.string()).describe("Up to 3 other likely exact products, most likely first; empty if sure"),
});
export type Identity = z.infer<typeof IdentifySchema>;

const { $schema: _drop, ...schema } = z.toJSONSchema(IdentifySchema) as Record<string, unknown>;
export const identifyJsonSchema = schema;

/** Below this the seller is asked what the item is. */
export const SURE_ENOUGH = 0.7;

export function identifyPrompt(language: string) {
  return `Look at the photo(s) of ONE item someone wants to sell second-hand. Identify the exact product (brand, model, variant, generation) from visible logos, labels, shape and details.
Be honest about confidence: 0.9+ only when a model name/label is visible or the design is unmistakable; 0.4-0.7 when you only recognise the brand or type.
Give up to 3 alternatives when unsure. Write names in ${language} where a translation is natural, keep brand and model names as they are. Answer only with the JSON.`;
}

export function normalizeIdentity(raw: unknown): Identity {
  let v = raw;
  if (typeof v === "string") {
    const m = /\{[\s\S]*\}/.exec(v);
    try {
      v = m ? JSON.parse(m[0]) : {};
    } catch {
      v = {};
    }
  }
  const o = (v ?? {}) as Partial<Record<keyof Identity, unknown>>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 120) : "";
  const alts = Array.isArray(o.alternatives) ? o.alternatives.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  const conf = typeof o.confidence === "number" && Number.isFinite(o.confidence) ? Math.min(1, Math.max(0, o.confidence)) : 0;
  return {
    name,
    category: typeof o.category === "string" ? o.category.slice(0, 60) : "",
    confidence: name ? conf : 0,
    alternatives: [...new Set(alts.map((a) => a.trim().slice(0, 120)))].filter((a) => a.toLowerCase() !== name.toLowerCase()).slice(0, 3),
  };
}

/** Line added to the AI's note once the seller confirmed or typed what the item is. */
export function identityNote(name: string) {
  return `The seller confirmed the item is: ${name}. Use this identification.`;
}
