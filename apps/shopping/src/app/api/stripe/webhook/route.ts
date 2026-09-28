import type Stripe from "stripe";
import { orders } from "@/lib/server/orders-db";
import { withEvent } from "@/lib/server/order-sync";
import { fromCents, stripe } from "@/lib/server/stripe";

/**
 * Stripe → Orbit payment updates. Configure in the Stripe dashboard:
 * Developers → Webhooks → endpoint https://YOUR-APP/api/stripe/webhook with
 * payment_intent.amount_capturable_updated and payment_intent.canceled.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook not configured" }, { status: 503 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "payment_intent.amount_capturable_updated" || event.type === "payment_intent.canceled") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const id = pi.metadata?.orderId;
    const order = id ? await orders().get(id) : null;
    if (order && order.paymentIntentId === pi.id) {
      if (event.type === "payment_intent.canceled" && order.status !== "cancelled") {
        await orders().put(withEvent(order, "cancelled", "Payment released"));
      } else if (event.type === "payment_intent.amount_capturable_updated" && order.status === "pending_payment") {
        await orders().put(withEvent(order, "held", `${fromCents(pi.amount_capturable).toFixed(2)} EUR reserved`));
      }
    }
  }
  return Response.json({ received: true });
}
