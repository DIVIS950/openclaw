import "server-only";
import { claude, MODEL } from "../ai";

// Small in-memory cache so repeat views don't pay for the same answer.
const cache = new Map<string, { at: number; text: string }>();
const TTL = 6 * 3600_000;

/** One Claude call with web search; returns the reply text (cached). */
export async function askWithSearch(key: string, prompt: string, maxSearches: number): Promise<string> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.text;
  const message = await claude()
    .beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      messages: [{ role: "user", content: prompt }],
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxSearches }],
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    })
    .finalMessage();
  if (message.stop_reason === "refusal") return "";
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  cache.set(key, { at: Date.now(), text });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return text;
}
