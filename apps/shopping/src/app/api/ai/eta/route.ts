import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { aiEnabled, claude, MODEL } from "@/lib/ai";
import { heuristicEta, parcelEvents, type Parcel } from "@/lib/parcels";

const PlaceSchema = z.object({
  city: z.string().max(80),
  country: z.string().max(4),
  iata: z.string().max(4),
  coords: z.tuple([z.number(), z.number()]),
});

const Body = z.object({
  parcel: z.object({
    id: z.string().max(64),
    title: z.string().max(200),
    store: z.string().max(80),
    carrier: z.string().max(80),
    trackingNumber: z.string().max(64),
    from: PlaceSchema,
    to: PlaceSchema,
    mode: z.enum(["air", "road"]),
    shippedAt: z.number(),
    promisedBy: z.number(),
    source: z.enum(["order", "gmail"]),
  }),
});

const EtaSchema = z.object({
  eta_iso: z.string().describe("Best estimate of delivery time, ISO 8601"),
  confidence: z.number().describe("0 to 1"),
  reasoning: z.string().describe("One or two short sentences for the user"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const parcel = parsed.data.parcel as Parcel;
  const fallback = heuristicEta(parcel);

  if (!aiEnabled()) return Response.json({ ...fallback, source: "heuristic" });

  try {
    const events = parcelEvents(parcel).filter((e) => e.done);
    const response = await claude().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(EtaSchema) },
      messages: [
        {
          role: "user",
          content: `Estimate when this parcel will be delivered. Now is ${new Date().toISOString()}.
Carrier: ${parcel.carrier} (${parcel.mode})
Route: ${parcel.from.city}, ${parcel.from.country} -> ${parcel.to.city}, ${parcel.to.country}
Carrier promise: by ${new Date(parcel.promisedBy).toISOString()}
Scan history:
${events.map((e) => `- ${new Date(e.at).toISOString()} ${e.label} (${e.place})`).join("\n")}`,
        },
      ],
    });
    const out = response.parsed_output;
    const eta = out ? Date.parse(out.eta_iso) : NaN;
    if (!out || Number.isNaN(eta)) return Response.json({ ...fallback, source: "heuristic" });
    return Response.json({ eta, confidence: Math.max(0, Math.min(1, out.confidence)), reasoning: out.reasoning, source: "claude" });
  } catch (err) {
    console.error("[orbit] eta failed", err);
    return Response.json({ ...fallback, source: "heuristic" });
  }
}
