import { z } from "zod";
import {
  CONDITIONS,
  CONDITION_LABEL,
  PLATFORMS,
  effectiveCondition,
  effectiveCopy,
  effectivePrice,
  type Condition,
  type Listing,
  type Platform,
  type Settings,
} from "./types.ts";

/**
 * The voice assistant on a listing: the seller talks (Czech by default), the AI answers in one or two
 * spoken sentences and may change the listing. Shared by every backend (Gemini, Claude, preview).
 */
export type AssistantTurn = { role: "user" | "assistant"; text: string };

const FIELDS = ["title", "description", "addToDescription", "price", "condition"] as const;

// Every field is required ("" / 0 / "unchanged" = no change): Gemini tends to skip optional ones.
export const AssistantReplySchema = z.object({
  changed: z.array(z.enum(FIELDS)).describe("Exactly the listing fields you are changing now. Empty when just answering."),
  title: z.string().describe("New title, or \"\" if 'title' is not in changed."),
  description: z.string().describe("Complete rewritten description, or \"\" if 'description' is not in changed."),
  addToDescription: z.string().describe("The sentence to add to the end of the description, or \"\" if 'addToDescription' is not in changed."),
  price: z.number().describe("New price as a plain number, or 0 if 'price' is not in changed."),
  condition: z.enum([...CONDITIONS, "unchanged"]).describe("New condition, or \"unchanged\"."),
  // Written last, after the changes, so it only mentions what was really changed.
  reply: z.string().describe("What to say back: 1-2 short, natural spoken sentences in the seller's language, mentioning only the changes above."),
});
type RawReply = z.infer<typeof AssistantReplySchema>;
export type AssistantChanges = Partial<Pick<RawReply, "title" | "description" | "addToDescription" | "price">> & { condition?: Condition };
export type AssistantReply = { reply: string; changes: AssistantChanges };

const { $schema: _drop, ...schema } = z.toJSONSchema(AssistantReplySchema) as Record<string, unknown>;
export const assistantJsonSchema = schema;

const LANGUAGE_NAME: Record<string, string> = { cs: "Czech", sk: "Slovak", en: "English", de: "German", pl: "Polish" };

/** Everything the AI needs in one prompt: the listing, the market data and the conversation so far. */
export function assistantPrompt(l: Listing, s: Settings, history: AssistantTurn[], text: string, language = "cs") {
  const a = l.analysis!;
  const vinted = effectiveCopy(l, "vinted");
  const facts = {
    item: a.item,
    condition: CONDITION_LABEL[effectiveCondition(l)],
    price: effectivePrice(l),
    currency: s.currency,
    marketRange: { low: a.price.low, high: a.price.high, suggested: a.price.suggested, quickSale: a.price.quickSale, demand: a.price.demand },
    priceReasoning: a.price.reasoning,
    comparables: a.comparables.slice(0, 6).map((c) => `${c.title}: ${c.price} ${c.currency} (${c.sold ? "sold" : "asking"}, ${c.source})`),
    title: vinted.title,
    description: vinted.description,
    listedOn: PLATFORMS.filter((p) => l.publish[p]?.status === "live"),
  };
  const talk = history
    .slice(-8)
    .map((t) => `${t.role === "user" ? "Seller" : "You"}: ${t.text}`)
    .join("\n");
  return `You are SnapSell's voice assistant. You help a private seller in ${s.country} sell a used item on Vinted, Facebook Marketplace and eBay.
Speak ${LANGUAGE_NAME[language] ?? "Czech"}, warm and brief: your reply is read aloud, so 1-2 short sentences, no lists, no markdown, say prices like a person would.
You can change the listing: title, description, price or condition. Only change what the seller asks for (or clearly agrees to).
When you change the description, write the complete new description in the listing's language (${s.language}). Keep it honest; never invent accessories or specs.
Answer questions (fair price, how fast it will sell, what to write) from the data below. If you don't know, say so.

LISTING:
${JSON.stringify(facts, null, 1)}
${talk ? `\nCONVERSATION SO FAR:\n${talk}\n` : ""}
Seller now says: "${text}"

Reply as JSON with every field: "changed" first, then the fields (empty "" / 0 / "unchanged" for anything not in "changed"), then "reply".
Never say you changed something that is not in "changed".
To add a detail to the description use "addToDescription" (one short sentence in ${s.language}); use "description" only to rewrite it (shorter, longer, different tone), and then give the whole new text.`;
}

/** Applies the assistant's changes as the seller's own edits (title/description on every site). */
export function applyAssistantChanges(l: Listing, c: AssistantChanges) {
  const edits = { ...l.edits, platforms: { ...l.edits.platforms } };
  if (c.title || c.description || c.addToDescription) {
    for (const p of PLATFORMS as readonly Platform[]) {
      const cur = effectiveCopy(l, p);
      let description = c.description ?? cur.description;
      if (c.addToDescription) description = addSentence(description, c.addToDescription.trim());
      edits.platforms[p] = {
        ...edits.platforms[p],
        // eBay allows 80 characters, Vinted 60 (Facebook titles are short too).
        title: c.title ? c.title.slice(0, p === "ebay" ? 80 : 60) : cur.title,
        description,
      };
    }
  }
  if (typeof c.price === "number" && c.price > 0) edits.price = Math.round(c.price);
  if (c.condition) edits.condition = c.condition;
  return edits;
}

/** Adds a sentence at the end of the text, but above a closing line of #hashtags (Vinted style). */
function addSentence(text: string, sentence: string) {
  const lines = text.trimEnd().split("\n");
  const tags = lines.length > 1 && /^\s*#\S+/.test(lines.at(-1)!) ? lines.pop()! : null;
  const body = lines.join("\n").trimEnd();
  return [body ? `${body}\n${sentence}` : sentence, tags].filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n");
}

/** Reads a model's JSON answer defensively and keeps only the fields it says it changed. */
export function parseAssistantReply(raw: unknown): AssistantReply {
  let v = raw;
  if (typeof v === "string") {
    const m = /\{[\s\S]*\}/.exec(v);
    try {
      v = m ? JSON.parse(m[0]) : { reply: v, changed: [] };
    } catch {
      v = { reply: v, changed: [] };
    }
  }
  const r = AssistantReplySchema.safeParse(v);
  if (!r.success) {
    const o = (v ?? {}) as { reply?: unknown };
    return { reply: typeof o.reply === "string" ? o.reply : "Promiňte, tomu jsem nerozuměl.", changes: {} };
  }
  const changes: AssistantChanges = {};
  let missing = false;
  for (const f of new Set(r.data.changed)) {
    const v = r.data[f];
    if (v !== "" && v !== 0 && v !== "unchanged") Object.assign(changes, { [f]: v });
    else missing = true;
  }
  // The model promised a change it didn't deliver: don't let the spoken reply claim it happened.
  const reply = missing ? `${r.data.reply} Část změn se ale nepovedla uložit, zkuste to prosím říct znovu.` : r.data.reply;
  return { reply, changes };
}
