import { OrderInput, priceOrder } from "@/lib/order-pricing";
import type { Order } from "@/lib/order-types";
import { dbConfigured, newId, newToken, orders } from "@/lib/server/orders-db";
import { stripe, stripeConfigured, toCents } from "@/lib/server/stripe";

const FEE_PERCENT = Number(process.env.ORBIT_FEE_PERCENT ?? 3);

// Simple per-IP limit on new orders.
const recent = new Map<string, number[]>();
function allowed(ip: string) {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (hits.length >= 8) return false;
  recent.set(ip, [...hits, now]);
  return true;
}

/**
 * Creates an order and a Stripe PaymentIntent with manual capture: the money
 * is only reserved on the card. It is charged when the order is placed at the
 * shop (admin), or released if the order is cancelled.
 */
export async function POST(req: Request) {
  if (!stripeConfigured || !dbConfigured) {
    return Response.json({ error: "Payments aren't set up yet." }, { status: 503 });
  }
  const parsed = OrderInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return Response.json({ error: `Please check ${first?.path.join(" ") || "your details"}.` }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowed(ip)) return Response.json({ error: "Too many orders, try again later." }, { status: 429 });

  const priced = priceOrder(parsed.data, FEE_PERCENT);
  if ("error" in priced) return Response.json({ error: priced.error }, { status: 400 });

  const now = Date.now();
  const order: Order = {
    id: newId(),
    token: newToken(),
    createdAt: now,
    status: "pending_payment",
    events: [{ at: now, status: "pending_payment" }],
    customer: parsed.data.customer,
    address: { ...parsed.data.address },
    coupon: parsed.data.coupon,
    ...priced,
  };

  const intent = await stripe().paymentIntents.create({
    amount: toCents(order.authorized),
    currency: "eur",
    capture_method: "manual",
    automatic_payment_methods: { enabled: true },
    receipt_email: order.customer.email,
    description: `Orbit ${order.id}: ${order.item.brand} ${order.item.title} from ${order.item.store}`.slice(0, 350),
    metadata: { orderId: order.id },
  });
  order.paymentIntentId = intent.id;
  await orders().put(order);

  return Response.json({ id: order.id, token: order.token, clientSecret: intent.client_secret, authorized: order.authorized });
}
