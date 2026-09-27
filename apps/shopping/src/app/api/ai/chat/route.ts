import { z } from "zod";
import { aiEnabled, claude, MODEL, SHOPPING_SYSTEM } from "@/lib/ai";
import { demoAnswer } from "@/lib/demo-ai";

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(30),
  city: z.string().max(80).optional(),
  productId: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { messages, city, productId } = parsed.data;
  if (messages[0].role !== "user") return Response.json({ error: "First message must be from the user" }, { status: 400 });

  const encoder = new TextEncoder();

  if (!aiEnabled()) {
    const text = demoAnswer(messages[messages.length - 1].content, city, productId);
    // Stream the canned answer in small chunks so the UI behaves like the real thing.
    const body = new ReadableStream({
      async start(controller) {
        for (const chunk of text.match(/.{1,6}/gs) ?? []) {
          controller.enqueue(encoder.encode(chunk));
          await new Promise((r) => setTimeout(r, 12));
        }
        controller.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Orbit-Mode": "demo" } });
  }

  const context = [city && `The user lives in ${city}.`, productId && `They are looking at product id "${productId}".`]
    .filter(Boolean)
    .join(" ");

  const stream = claude().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    system: SHOPPING_SYSTEM + (context ? `\n\n${context}` : ""),
    messages,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    // Web search lets Claude check live prices and look up unfamiliar shops.
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
    // Server-side refusal fallback: if a request is declined, the API retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  const body = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(encoder.encode("\n\nSorry — I can't help with that request."));
        }
      } catch (err) {
        console.error("[orbit] chat stream failed", err);
        controller.enqueue(encoder.encode("\n\n_The assistant is temporarily unavailable. Please try again._"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Orbit-Mode": "live" } });
}
