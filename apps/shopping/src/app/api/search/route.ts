import { z } from "zod";
import { aiEnabled, claude, MODEL } from "@/lib/ai";
import { searchPrompt } from "@/lib/search";
import { clientIp, createLimiter } from "@/lib/server/rate-limit";

const Body = z.object({ q: z.string().trim().min(1).max(200), city: z.string().max(80).default("Prague") });

// Per-IP rate limit so a public deployment can't run up the API bill.
const allowed = createLimiter(12, 60_000);

// Finished searches are reused for 15 minutes (same query + city).
const cache = new Map<string, { at: number; text: string }>();

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (!aiEnabled()) return new Response(null, { status: 204, headers: { "X-Orbit-Mode": "demo" } });

  const { q, city } = parsed.data;
  const key = `${q.toLowerCase()}|${city}`;
  const hit = cache.get(key);
  const headers = { "Content-Type": "text/plain; charset=utf-8", "X-Orbit-Mode": "live" };
  if (hit && Date.now() - hit.at < 15 * 60_000) return new Response(hit.text, { headers });

  if (!allowed(clientIp(req))) return Response.json({ error: "Too many searches — wait a minute." }, { status: 429 });

  const stream = claude().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    messages: [{ role: "user", content: searchPrompt(q, city, true) }],
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      let full = "";
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            full += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        cache.set(key, { at: Date.now(), text: full });
      } catch (err) {
        console.error("[orbit] search failed", err);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers });
}
