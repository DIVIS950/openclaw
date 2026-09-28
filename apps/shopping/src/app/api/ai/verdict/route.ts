import { z } from "zod";
import { aiEnabled } from "@/lib/ai";
import { cleanVerdict, extractJson, heuristicVerdict, verdictPrompt } from "@/lib/prompts";
import { askWithSearch } from "@/lib/server/ask";

const Body = z.object({
  title: z.string().max(120),
  brand: z.string().max(60),
  typicalPrice: z.number().finite().min(0).max(100000),
  city: z.string().max(80),
  offers: z.array(z.object({ store: z.string().max(60), domain: z.string().max(100), price: z.number().finite(), trust: z.number().min(0).max(100) })).max(10),
});

/** AI opinion: should the shopper buy this now? Falls back to rules without a key. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const v = parsed.data;
  if (!aiEnabled()) return Response.json({ ...heuristicVerdict(v), source: "rules" });
  try {
    const key = `verdict|${v.brand}|${v.title}|${v.offers.map((o) => `${o.domain}:${o.price}`).join(",")}`;
    const verdict = cleanVerdict(extractJson(await askWithSearch(key, verdictPrompt(v, true), 3)));
    return Response.json(verdict ? { ...verdict, source: "claude" } : { ...heuristicVerdict(v), source: "rules" });
  } catch (err) {
    console.error("[orbit] verdict failed", err);
    return Response.json({ ...heuristicVerdict(v), source: "rules" });
  }
}
