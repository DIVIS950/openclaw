import "server-only";
import type { TranscriptLine } from "./call-results";
import { sql } from "./db";
import { TIME_ZONE } from "./limits";
import type { PaymentMethod } from "./settings";

export type OrderStatus =
  | "draft"
  | "dialing"
  | "calling"
  | "processing"
  | "confirmed"
  | "not_confirmed"
  | "failed"
  | "cancelled";

export const ACTIVE_STATUSES: readonly OrderStatus[] = ["dialing", "calling", "processing"];

/** Plain, serializable order (safe to pass to client components). */
export type Order = {
  id: string;
  restaurantName: string;
  restaurantPhone: string;
  items: string;
  budgetCzk: number;
  deliveryAddress: string;
  customerName: string;
  customerPhone: string;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  elStatus: string | null;
  conversationId: string | null;
  callStartedAt: string | null;
  callEndedAt: string | null;
  lastSyncedAt: string | null;
  orderConfirmed: boolean | null;
  totalCzk: number | null;
  etaMinutes: number | null;
  notes: string | null;
  summary: string | null;
  transcript: TranscriptLine[];
  error: string | null;
  createdAt: string;
};

export type OrderRow = {
  id: string;
  restaurant_name: string;
  restaurant_phone: string;
  items: string;
  budget_czk: number;
  delivery_address: string;
  customer_name: string;
  customer_phone: string;
  payment_method: string;
  status: OrderStatus;
  el_status: string | null;
  conversation_id: string | null;
  call_started_at: Date | null;
  call_ended_at: Date | null;
  last_synced_at: Date | null;
  order_confirmed: boolean | null;
  total_czk: number | null;
  eta_minutes: number | null;
  notes: string | null;
  summary: string | null;
  transcript: TranscriptLine[] | null;
  error: string | null;
  created_at: Date;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    restaurantName: row.restaurant_name,
    restaurantPhone: row.restaurant_phone,
    items: row.items,
    budgetCzk: row.budget_czk,
    deliveryAddress: row.delivery_address,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    paymentMethod: row.payment_method === "card" ? "card" : "cash",
    status: row.status,
    elStatus: row.el_status,
    conversationId: row.conversation_id,
    callStartedAt: iso(row.call_started_at),
    callEndedAt: iso(row.call_ended_at),
    lastSyncedAt: iso(row.last_synced_at),
    orderConfirmed: row.order_confirmed,
    totalCzk: row.total_czk === null ? null : Number(row.total_czk),
    etaMinutes: row.eta_minutes,
    notes: row.notes,
    summary: row.summary,
    transcript: Array.isArray(row.transcript) ? row.transcript : [],
    error: row.error,
    createdAt: row.created_at.toISOString(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrderId(id: string): boolean {
  return UUID.test(id);
}

export async function getOrder(id: string): Promise<Order | null> {
  if (!isOrderId(id)) return null;
  const [row] = await sql<OrderRow>`SELECT * FROM orders WHERE id = ${id}`;
  return row ? toOrder(row) : null;
}

/** Orders that reached the phone (drafts and cancelled summaries are not history). */
export async function listHistory(limit = 100): Promise<Order[]> {
  const rows = await sql<OrderRow>`
    SELECT * FROM orders WHERE status NOT IN ('draft', 'cancelled')
    ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(toOrder);
}

export async function listActiveOrders(): Promise<Order[]> {
  const rows = await sql<OrderRow>`
    SELECT * FROM orders WHERE status IN ('dialing', 'calling', 'processing') ORDER BY created_at`;
  return rows.map(toOrder);
}

export type DraftInput = {
  restaurantName: string;
  restaurantPhone: string;
  items: string;
  budgetCzk: number;
  deliveryAddress: string;
  customerName: string;
  customerPhone: string;
  paymentMethod: PaymentMethod;
};

export async function createDraft(input: DraftInput): Promise<string> {
  const [row] = await sql<{ id: string }>`
    INSERT INTO orders (restaurant_name, restaurant_phone, items, budget_czk, delivery_address,
                        customer_name, customer_phone, payment_method)
    VALUES (${input.restaurantName}, ${input.restaurantPhone}, ${input.items}, ${input.budgetCzk},
            ${input.deliveryAddress}, ${input.customerName}, ${input.customerPhone}, ${input.paymentMethod})
    RETURNING id`;
  return row.id;
}

export async function cancelDraft(id: string): Promise<void> {
  if (!isOrderId(id)) return;
  await sql`UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = ${id} AND status = 'draft'`;
}

/** Start of "today" in Prague, as a SQL expression evaluated by Postgres. */
export async function callsToday(): Promise<number> {
  const [row] = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM orders
    WHERE call_started_at >= (date_trunc('day', now() AT TIME ZONE ${TIME_ZONE}::text) AT TIME ZONE ${TIME_ZONE}::text)`;
  return row?.n ?? 0;
}

// ---------- Saved restaurants ----------

export type Restaurant = { id: number; name: string; phone: string };

export async function listRestaurants(): Promise<Restaurant[]> {
  return sql<Restaurant>`SELECT id, name, phone FROM restaurants ORDER BY last_used_at DESC LIMIT 50`;
}

export async function upsertRestaurant(name: string, phone: string): Promise<void> {
  await sql`
    INSERT INTO restaurants (name, phone) VALUES (${name}, ${phone})
    ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, last_used_at = now()`;
}

export async function touchRestaurant(phone: string): Promise<void> {
  await sql`UPDATE restaurants SET last_used_at = now() WHERE phone = ${phone}`;
}

export async function deleteRestaurant(id: number): Promise<void> {
  await sql`DELETE FROM restaurants WHERE id = ${id}`;
}
