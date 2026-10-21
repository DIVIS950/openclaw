"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { startCall } from "@/lib/calls";
import { MIN_BUDGET_CZK } from "@/lib/limits";
import { cancelDraft, createDraft, getOrder, isOrderId, touchRestaurant, upsertRestaurant } from "@/lib/orders";
import { normalizeCustomerPhone, normalizeCzechPhone } from "@/lib/phone";
import { getSettings, profileComplete } from "@/lib/settings";

export type DraftFormState = {
  error: string | null;
  fieldErrors: Partial<Record<"restaurantName" | "restaurantPhone" | "items" | "budget", string>>;
};

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function createDraftAction(_prev: DraftFormState, formData: FormData): Promise<DraftFormState> {
  await requireSession();
  const settings = await getSettings();
  if (!profileComplete(settings) || !normalizeCustomerPhone(settings.customerPhone)) {
    return { error: "Add your name, phone and delivery address in Settings first.", fieldErrors: {} };
  }

  const restaurantName = text(formData, "restaurantName");
  const restaurantPhone = normalizeCzechPhone(text(formData, "restaurantPhone"));
  const items = text(formData, "items");
  const budget = Number(text(formData, "budget"));

  const fieldErrors: DraftFormState["fieldErrors"] = {};
  if (!restaurantName || restaurantName.length > 80) fieldErrors.restaurantName = "Enter the restaurant name (max 80 characters).";
  if (!restaurantPhone) {
    fieldErrors.restaurantPhone = "Only Czech numbers (+420 and 9 digits). 8xx/9xx premium numbers are blocked.";
  }
  if (!items || items.length > 500) fieldErrors.items = "Write what you want (max 500 characters).";
  if (!Number.isInteger(budget) || budget < MIN_BUDGET_CZK || budget > settings.maxBudgetCzk) {
    fieldErrors.budget = `Budget must be a whole number from ${MIN_BUDGET_CZK} to ${settings.maxBudgetCzk} CZK.`;
  }
  if (Object.keys(fieldErrors).length > 0 || !restaurantPhone) {
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }

  if (formData.get("saveRestaurant") === "on") {
    await upsertRestaurant(restaurantName, restaurantPhone);
  } else {
    await touchRestaurant(restaurantPhone);
  }

  // Editing a summary replaces it, so the old one can never be called.
  const replaces = text(formData, "replaces");
  if (replaces) await cancelDraft(replaces);

  const id = await createDraft({
    restaurantName,
    restaurantPhone,
    items,
    budgetCzk: budget,
    deliveryAddress: settings.deliveryAddress,
    customerName: settings.customerName,
    customerPhone: settings.customerPhone,
    paymentMethod: settings.paymentMethod,
  });
  redirect(`/orders/${id}`);
}

export type CallState = { error: string | null };

/** The "Yes, call" button. The only code path in the app that places a phone call. */
export async function startCallAction(orderId: string, _prev: CallState, _formData: FormData): Promise<CallState> {
  await requireSession();
  const result = await startCall(orderId);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/orders/${orderId}`);
  redirect(`/orders/${orderId}`);
}

export async function cancelDraftAction(orderId: string): Promise<void> {
  await requireSession();
  await cancelDraft(orderId);
  redirect("/");
}

/** One tap from history: copies the order into a fresh summary. It still needs "Yes, call". */
export async function reorderAction(orderId: string): Promise<void> {
  await requireSession();
  if (!isOrderId(orderId)) redirect("/history");
  const [order, settings] = await Promise.all([getOrder(orderId), getSettings()]);
  if (!order) redirect("/history");
  if (!profileComplete(settings)) redirect("/settings");

  await touchRestaurant(order.restaurantPhone);
  const id = await createDraft({
    restaurantName: order.restaurantName,
    restaurantPhone: order.restaurantPhone,
    items: order.items,
    // Never carry over a budget above today's hard limit.
    budgetCzk: Math.min(order.budgetCzk, settings.maxBudgetCzk),
    deliveryAddress: settings.deliveryAddress,
    customerName: settings.customerName,
    customerPhone: settings.customerPhone,
    paymentMethod: settings.paymentMethod,
  });
  redirect(`/orders/${id}`);
}
