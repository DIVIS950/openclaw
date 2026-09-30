import { safeEqual } from "@/lib/server/admin-auth";
import { orders } from "@/lib/server/orders-db";
import { syncPayment, toPublic } from "@/lib/server/order-sync";

// Customers see their order with the secret token their device received at checkout.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.headers.get("x-order-token") ?? "";
  const order = /^ord_[a-z0-9]+$/.test(id) ? await orders().get(id) : null;
  const ok = order && safeEqual(token, order.token);
  if (!order || !ok) return Response.json({ error: "Order not found" }, { status: 404 });
  try {
    return Response.json(toPublic(await syncPayment(order)));
  } catch {
    return Response.json(toPublic(order));
  }
}
