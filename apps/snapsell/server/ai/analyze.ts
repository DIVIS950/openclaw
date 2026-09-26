import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AnalysisSchema, type Analysis, type AnalyzeEvent, type Settings } from "../../shared/types.ts";
import { demoAnalysis } from "./demo.ts";

export const MODEL = process.env.SNAPSELL_MODEL ?? "claude-opus-5";
// Server-side refusal fallbacks: if the primary model declines, the API re-runs the request
// on a fallback model inside the same call.
const BETAS = ["server-side-fallback-2026-07-01"];

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export type Photo = { data: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" };
type Emit = (e: AnalyzeEvent) => void;

function imageBlocks(photos: Photo[]): BetaContentBlockParam[] {
  return photos.flatMap((p, i) => [
    { type: "text" as const, text: `Photo ${i}:` },
    {
      type: "image" as const,
      source: { type: "base64" as const, media_type: p.mediaType, data: p.data.toString("base64") },
    },
  ]);
}

function context(settings: Settings, note?: string, visual?: string) {
  return [
    `Seller location: ${settings.country}. Currency: ${settings.currency}.`,
    `Write all buyer-facing text in ${settings.language}.`,
    note ? `Seller's note about the item: """${note}"""` : "",
    visual ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

const RESEARCH_SYSTEM = `You are an expert resale appraiser who helps people sell used items on eBay, Facebook Marketplace and Vinted.
Look carefully at the photos: identify the exact item (brand, model, variant, size, generation), and judge its condition honestly from what is visible.
Then research the current second-hand market with web search: prefer SOLD / completed prices (eBay sold listings, Vinted, Facebook Marketplace, local classifieds) in the seller's country, and note active asking prices separately.
Finish with a concise research report: identification and confidence, condition findings, a list of comparable listings (title, price, currency, site, URL, sold or asking), and your price recommendation (low / high / suggested / quick-sale) with reasoning.`;

const COMPOSE_SYSTEM = `You turn an appraiser's research report and item photos into a ready-to-post marketplace listing.
Rules:
- Be accurate and honest: mention visible flaws, never invent accessories, specs or authenticity that are not supported by the photos or research.
- eBay: title max 80 characters, keyword-dense (brand, model, key spec, size, color). Description structured with short sections and bullet points: overview, condition, what's included, specifics.
- Facebook Marketplace: short, friendly title. Conversational description of 3-6 short lines, mention pickup or shipping is possible.
- Vinted: title max 60 characters. Casual, warm description mentioning brand, size, condition, measurements if known, ending with 3-6 relevant hashtags.
- Prices are numbers in the seller's currency, rounded the way people actually price things (e.g. 45, 119, 1,250).
- crops: for every photo give a tight bounding box around the item (normalized 0-1) so it can be auto-cropped.`;

/** Runs the two-step AI pipeline: vision + live market research, then structured listing output. */
export async function analyzeItem(
  photos: Photo[],
  settings: Settings,
  note: string | undefined,
  emit: Emit,
  /** Google Lens / Cloud Vision findings, already formatted as text */
  visual?: string,
): Promise<Analysis> {
  if (!aiConfigured()) return demoAnalysis(photos.length, settings, emit);

  const client = new Anthropic();
  emit({ type: "stage", stage: "looking" });

  // Step 1: identify + research the market with web search.
  const messages: BetaMessageParam[] = [
    {
      role: "user",
      content: [
        ...imageBlocks(photos),
        { type: "text", text: `${context(settings, note, visual)}\n\nIdentify this item and research what it sells for.` },
      ],
    },
  ];
  const research: string[] = [];
  // Server tool turns can pause; resume a few times before giving up.
  for (let turn = 0; turn < 4; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: BETAS,
      fallbacks: "default",
      system: RESEARCH_SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      messages,
    });
    stream.on("contentBlock", (block: BetaContentBlock) => {
      if (block.type === "server_tool_use" && block.name === "web_search") {
        emit({ type: "stage", stage: "searching" });
        const query = (block.input as { query?: string }).query;
        if (query) emit({ type: "search", query });
      } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content.slice(0, 3)) emit({ type: "source", title: r.title, url: r.url });
      }
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("The AI declined to analyze these photos.");
    for (const b of msg.content) if (b.type === "text") research.push(b.text);
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }

  // Step 2: structured listing. Kept separate because citations from web search can't be
  // combined with structured output in the same request.
  emit({ type: "stage", stage: "pricing" });
  emit({ type: "stage", stage: "writing" });
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: BETAS,
    fallbacks: "default",
    system: COMPOSE_SYSTEM,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: betaZodOutputFormat(AnalysisSchema) },
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks(photos),
          {
            type: "text",
            text: `${context(settings, note, visual)}\n\nResearch report:\n${research.join("\n").trim() || "(no research available, estimate from your knowledge)"}\n\nThere are ${photos.length} photos. Produce the listing.`,
          },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal") throw new Error("The AI declined to write this listing.");
  if (!res.parsed_output) throw new Error("The AI response could not be parsed. Try again.");
  return res.parsed_output;
}
