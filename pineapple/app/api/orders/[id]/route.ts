import { hasValidSession } from "@/lib/auth";
import { syncOrder } from "@/lib/calls";
import { getOrder } from "@/lib/orders";

const noStore = { "cache-control": "no-store" };

/** Polled by the live call screen. Syncs the order with ElevenLabs and returns it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasValidSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) return Response.json({ error: "not found" }, { status: 404, headers: noStore });
  return Response.json(await syncOrder(order), { headers: noStore });
}
