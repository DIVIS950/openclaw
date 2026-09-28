"use server";

import { revalidatePath } from "next/cache";
import { round2 } from "@/lib/order-types";
import { checkPassword, endAdminSession, isAdmin, startAdminSession } from "@/lib/server/admin-auth";
import { orders } from "@/lib/server/orders-db";
import { withEvent } from "@/lib/server/order-sync";
import { fromCents, stripe, toCents } from "@/lib/server/stripe";

export type ActionResult = { ok: boolean; message: string };

async function load(id: string) {
  if (!(await isAdmin())) throw new Error("Not signed in");
  const order = await orders().get(id);
  if (!order) throw new Error("Order not found");
  return order;
}

const text = (f: FormData, k: string, max = 120) => String(f.get(k) ?? "").trim().slice(0, max);

export async function login(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  // Slow down guessing a little.
  await new Promise((r) => setTimeout(r, 400));
  if (!checkPassword(String(form.get("password") ?? ""))) return { ok: false, message: "Wrong password." };
  await startAdminSession();
  revalidatePath("/admin");
  return { ok: true, message: "" };
}

export async function logout() {
  await endAdminSession();
  revalidatePath("/admin");
}

/**
 * You placed the order at the shop: record its order number and charge the
 * customer. The charge is the final price (lower if a coupon worked), never
 * more than the amount they approved.
 */
export async function markOrdered(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const order = await load(text(form, "id"));
    if (order.status !== "held") return { ok: false, message: "Only orders with a reserved payment can be placed." };
    const shopOrderNumber = text(form, "shopOrderNumber", 80);
    if (!shopOrderNumber) return { ok: false, message: "Enter the shop's order number." };
    const finalRaw = text(form, "finalAmount", 20).replace(",", ".");
    const finalAmount = finalRaw ? round2(Number(finalRaw)) : order.authorized;
    if (!(finalAmount > 0) || finalAmount > order.authorized) {
      return { ok: false, message: `The amount must be between 0 and ${order.authorized.toFixed(2)} EUR (what the customer approved).` };
    }
    const pi = await stripe().paymentIntents.capture(order.paymentIntentId!, { amount_to_capture: toCents(finalAmount) });
    const charged = fromCents(pi.amount_received);
    await orders().put({
      ...withEvent(order, "ordered", `Shop order ${shopOrderNumber}`),
      shopOrderNumber,
      charged,
    });
    revalidatePath("/admin");
    return { ok: true, message: `Charged ${charged.toFixed(2)} EUR.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}

export async function markShipped(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const order = await load(text(form, "id"));
    if (order.status !== "ordered") return { ok: false, message: "Mark the order as placed first." };
    const trackingNumber = text(form, "trackingNumber", 60);
    const carrier = text(form, "carrier", 40) || order.delivery.carrier;
    if (!trackingNumber) return { ok: false, message: "Enter the tracking number." };
    await orders().put({ ...withEvent(order, "shipped", `${carrier} ${trackingNumber}`), trackingNumber, carrier });
    revalidatePath("/admin");
    return { ok: true, message: "Marked as shipped." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}

export async function markDelivered(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const order = await load(text(form, "id"));
    if (order.status !== "shipped") return { ok: false, message: "Only shipped orders can be delivered." };
    await orders().put(withEvent(order, "delivered"));
    revalidatePath("/admin");
    return { ok: true, message: "Marked as delivered." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/** Releases the reserved money; the customer is never charged. */
export async function cancelOrder(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const order = await load(text(form, "id"));
    if (order.status !== "held" && order.status !== "pending_payment") return { ok: false, message: "This order was already charged; refund it in the Stripe dashboard." };
    const reason = text(form, "reason", 200) || "Cancelled by Orbit";
    if (order.paymentIntentId) {
      const pi = await stripe().paymentIntents.retrieve(order.paymentIntentId);
      if (pi.status !== "canceled") await stripe().paymentIntents.cancel(order.paymentIntentId);
    }
    await orders().put(withEvent(order, "cancelled", reason));
    revalidatePath("/admin");
    return { ok: true, message: "Cancelled; the reserved money was released." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}
