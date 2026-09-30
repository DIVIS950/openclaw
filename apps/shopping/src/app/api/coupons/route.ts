import { z } from "zod";
import { aiEnabled } from "@/lib/ai";
import { cleanCoupons, couponPrompt, extractJson } from "@/lib/prompts";
import { askWithSearch } from "@/lib/server/ask";
import { clientIp, createLimiter } from "@/lib/server/rate-limit";

const allowed = createLimiter(10, 60_000);

const Body = z.object({ store: z.string().max(60), domain: z.string().max(100), product: z.string().max(160) });

/**
 * Looks for published discount codes for a shop. Codes are not guaranteed:
 * Orbit tries them when placing the order and charges less only if one works.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (!allowed(clientIp(req))) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!aiEnabled()) return Response.json({ coupons: [], source: "off" });
  const { store, domain, product } = parsed.data;
  try {
    const text = await askWithSearch(`coupons|${domain}|${product}`, couponPrompt(store, domain, product), 4);
    return Response.json({ coupons: cleanCoupons(extractJson(text)), source: "claude" });
  } catch (err) {
    console.error("[orbit] coupon search failed", err);
    return Response.json({ coupons: [], source: "error" });
  }
}
