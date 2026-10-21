import "server-only";
import { sql } from "./db";
import { DEFAULT_MAX_BUDGET_CZK } from "./limits";

export type PaymentMethod = "cash" | "card";

export type Settings = {
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  paymentMethod: PaymentMethod;
  maxBudgetCzk: number;
  /** Effective IDs: env vars win over values saved from the in-app setup. */
  agentId: string | null;
  agentIdFromEnv: boolean;
  phoneNumberId: string | null;
  phoneNumberIdFromEnv: boolean;
};

type SettingsRow = {
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  payment_method: string;
  max_budget_czk: number;
  agent_id: string | null;
  phone_number_id: string | null;
};

export async function getSettings(): Promise<Settings> {
  const [row] = await sql<SettingsRow>`SELECT * FROM settings WHERE id = 1`;
  const envAgent = process.env.ELEVENLABS_AGENT_ID?.trim() || null;
  const envPhone = process.env.ELEVENLABS_PHONE_NUMBER_ID?.trim() || null;
  return {
    customerName: row?.customer_name ?? "",
    customerPhone: row?.customer_phone ?? "",
    deliveryAddress: row?.delivery_address ?? "",
    paymentMethod: row?.payment_method === "card" ? "card" : "cash",
    maxBudgetCzk: row?.max_budget_czk ?? DEFAULT_MAX_BUDGET_CZK,
    agentId: envAgent ?? row?.agent_id ?? null,
    agentIdFromEnv: envAgent !== null,
    phoneNumberId: envPhone ?? row?.phone_number_id ?? null,
    phoneNumberIdFromEnv: envPhone !== null,
  };
}

export async function saveProfile(values: {
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  paymentMethod: PaymentMethod;
  maxBudgetCzk: number;
}): Promise<void> {
  await sql`
    UPDATE settings SET
      customer_name = ${values.customerName},
      customer_phone = ${values.customerPhone},
      delivery_address = ${values.deliveryAddress},
      payment_method = ${values.paymentMethod},
      max_budget_czk = ${values.maxBudgetCzk},
      updated_at = now()
    WHERE id = 1`;
}

export async function saveAgentId(agentId: string): Promise<void> {
  await sql`UPDATE settings SET agent_id = ${agentId}, updated_at = now() WHERE id = 1`;
}

export async function savePhoneNumberId(phoneNumberId: string): Promise<void> {
  await sql`UPDATE settings SET phone_number_id = ${phoneNumberId}, updated_at = now() WHERE id = 1`;
}

export function profileComplete(settings: Settings): boolean {
  return Boolean(settings.customerName && settings.customerPhone && settings.deliveryAddress);
}

/** How the agent says the payment method (Czech first, English hint for the switch). */
export function paymentMethodForAgent(method: PaymentMethod): string {
  return method === "card"
    ? "kartou kurýrovi při převzetí (card to the courier)"
    : "hotově při převzetí (cash)";
}

export function paymentMethodLabel(method: PaymentMethod): string {
  return method === "card" ? "Card to the courier" : "Cash";
}
