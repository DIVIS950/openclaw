"use server";

import { revalidatePath } from "next/cache";
import { agentOptionsFromEnv } from "@/lib/agent-config";
import { requireSession } from "@/lib/auth";
import { createAgent, listPhoneNumbers, updateAgent } from "@/lib/elevenlabs";
import { MAX_BUDGET_SETTING_CEILING_CZK, MIN_BUDGET_CZK } from "@/lib/limits";
import { deleteRestaurant } from "@/lib/orders";
import { normalizeCustomerPhone } from "@/lib/phone";
import { getSettings, saveAgentId, savePhoneNumberId, saveProfile } from "@/lib/settings";

export type ActionMessage = { ok: boolean; message: string } | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function saveProfileAction(_prev: ActionMessage, formData: FormData): Promise<ActionMessage> {
  await requireSession();
  const customerName = text(formData, "customerName");
  const customerPhone = normalizeCustomerPhone(text(formData, "customerPhone"));
  const deliveryAddress = text(formData, "deliveryAddress");
  const paymentMethod = text(formData, "paymentMethod") === "card" ? "card" : "cash";
  const maxBudgetCzk = Number(text(formData, "maxBudgetCzk"));

  if (!customerName || customerName.length > 80) return { ok: false, message: "Enter your name (max 80 characters)." };
  if (!customerPhone) return { ok: false, message: "Enter your phone number, e.g. +420 777 123 456." };
  if (!deliveryAddress || deliveryAddress.length > 300) {
    return { ok: false, message: "Enter the delivery address (max 300 characters)." };
  }
  if (!Number.isInteger(maxBudgetCzk) || maxBudgetCzk < MIN_BUDGET_CZK || maxBudgetCzk > MAX_BUDGET_SETTING_CEILING_CZK) {
    return { ok: false, message: `Max budget must be a whole number from ${MIN_BUDGET_CZK} to ${MAX_BUDGET_SETTING_CEILING_CZK} CZK.` };
  }

  await saveProfile({ customerName, customerPhone, deliveryAddress, paymentMethod, maxBudgetCzk });
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
}

export async function deleteRestaurantAction(restaurantId: number): Promise<void> {
  await requireSession();
  if (Number.isInteger(restaurantId)) await deleteRestaurant(restaurantId);
  revalidatePath("/", "layout");
}

export async function createAgentAction(_prev: ActionMessage, _formData: FormData): Promise<ActionMessage> {
  await requireSession();
  const settings = await getSettings();
  if (settings.agentId) return { ok: false, message: "An agent already exists. Use “Update agent” instead." };
  try {
    const agentId = await createAgent(agentOptionsFromEnv());
    await saveAgentId(agentId);
    revalidatePath("/settings");
    return { ok: true, message: `Agent created: ${agentId}` };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export async function updateAgentAction(_prev: ActionMessage, _formData: FormData): Promise<ActionMessage> {
  await requireSession();
  const settings = await getSettings();
  if (!settings.agentId) return { ok: false, message: "Create the agent first." };
  try {
    await updateAgent(settings.agentId, agentOptionsFromEnv());
    return { ok: true, message: "Agent updated with the latest prompt and settings." };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export async function selectPhoneNumberAction(
  phoneNumberId: string,
  _prev: ActionMessage,
  _formData: FormData,
): Promise<ActionMessage> {
  await requireSession();
  try {
    // Only accept an ID that really belongs to this ElevenLabs account.
    const numbers = await listPhoneNumbers();
    if (!numbers.some((n) => n.phone_number_id === phoneNumberId)) {
      return { ok: false, message: "That number is not in your ElevenLabs account." };
    }
    await savePhoneNumberId(phoneNumberId);
    revalidatePath("/settings");
    return { ok: true, message: "Caller number selected." };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}
