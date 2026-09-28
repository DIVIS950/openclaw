import "server-only";
import type { Order, OrderStatus, PublicOrder } from "../order-types";
import { orders } from "./orders-db";
import { fromCents, stripe } from "./stripe";

export function withEvent(order: Order, status: OrderStatus, note?: string): Order {
  if (order.status === status && !note) return order;
  return { ...order, status, events: [...order.events, { at: Date.now(), status, note }] };
}

export function toPublic(order: Order): PublicOrder {
  const { token: _t, paymentIntentId: _p, ...rest } = order;
  return rest;
}

/**
 * Brings an order that's waiting on the customer's payment in line with
 * Stripe. Webhooks do the same; this covers a missed or slow webhook.
 */
export async function syncPayment(order: Order): Promise<Order> {
  if (!order.paymentIntentId || (order.status !== "pending_payment" && order.status !== "held")) return order;
  const pi = await stripe().paymentIntents.retrieve(order.paymentIntentId);
  let next = order;
  if (pi.status === "requires_capture" && order.status === "pending_payment") next = withEvent(order, "held", `${fromCents(pi.amount_capturable).toFixed(2)} EUR reserved`);
  else if (pi.status === "canceled") next = withEvent(order, "cancelled", "Payment released");
  if (next !== order) await orders().put(next);
  return next;
}
