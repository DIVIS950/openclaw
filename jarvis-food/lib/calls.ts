import "server-only";
import { describeFailure, extractResults, toTranscript } from "./call-results";
import { isUniqueViolation, sql } from "./db";
import { ElevenLabsError, getConversation, startTwilioOutboundCall, type Conversation } from "./elevenlabs";
import { DRAFT_TTL_MINUTES, MAX_CALLS_PER_DAY, MIN_BUDGET_CZK, STUCK_CALL_MINUTES, TIME_ZONE } from "./limits";
import { getOrder, isOrderId, listActiveOrders, toOrder, type Order, type OrderRow } from "./orders";
import { formatPhone, normalizeCzechPhone } from "./phone";
import { getSettings, paymentMethodForAgent } from "./settings";

export type StartCallResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): StartCallResult => ({ ok: false, error });

function minutesSince(isoDate: string | null): number {
  return isoDate ? (Date.now() - new Date(isoDate).getTime()) / 60_000 : 0;
}

/**
 * Places the phone call for a draft. Only reachable from the "Yes, call" button on the summary
 * screen. Every safety limit is re-checked here, and the claim on the order is a single atomic
 * UPDATE so double taps or parallel requests can never start two calls.
 */
export async function startCall(orderId: string): Promise<StartCallResult> {
  if (!isOrderId(orderId)) return fail("Order not found.");
  if (!process.env.ELEVENLABS_API_KEY) return fail("ELEVENLABS_API_KEY is not set in Vercel.");

  const settings = await getSettings();
  if (!settings.agentId) return fail("No voice agent yet. Create it in Settings → Voice agent.");
  if (!settings.phoneNumberId) return fail("No caller number selected. Pick one in Settings → Voice agent.");

  const order = await getOrder(orderId);
  if (!order) return fail("Order not found.");
  if (order.status !== "draft") return fail("This order was already handled.");

  const toNumber = normalizeCzechPhone(order.restaurantPhone);
  if (!toNumber) return fail("Only Czech (+420) restaurant numbers can be called.");
  if (order.budgetCzk < MIN_BUDGET_CZK || order.budgetCzk > settings.maxBudgetCzk) {
    return fail(`Budget must be between ${MIN_BUDGET_CZK} and ${settings.maxBudgetCzk} CZK. Edit the order.`);
  }

  // Close out calls that already ended (or got stuck) so they don't block this one.
  await syncActiveOrders();

  let claimed: Array<{ id: string }>;
  try {
    claimed = await sql<{ id: string }>`
      UPDATE orders SET status = 'dialing', call_started_at = now(), updated_at = now()
      WHERE id = ${orderId}
        AND status = 'draft'
        AND created_at > now() - make_interval(mins => ${DRAFT_TTL_MINUTES}::int)
        AND (SELECT count(*) FROM orders
             WHERE call_started_at >= (date_trunc('day', now() AT TIME ZONE ${TIME_ZONE}::text)
                                       AT TIME ZONE ${TIME_ZONE}::text)) < ${MAX_CALLS_PER_DAY}
      RETURNING id`;
  } catch (error) {
    // orders_one_active_call unique index: another order is already dialing or on a call.
    if (isUniqueViolation(error)) return fail("Another call is in progress. Wait until it finishes.");
    throw error;
  }

  if (claimed.length === 0) {
    const fresh = await getOrder(orderId);
    if (fresh?.status !== "draft") return fail("This order was already handled.");
    if (minutesSince(fresh.createdAt) > DRAFT_TTL_MINUTES) {
      return fail("This summary expired. Tap Edit and review the order again.");
    }
    return fail(`Daily limit reached: max ${MAX_CALLS_PER_DAY} calls per day.`);
  }

  try {
    const call = await startTwilioOutboundCall({
      agentId: settings.agentId,
      agentPhoneNumberId: settings.phoneNumberId,
      toNumber,
      dynamicVariables: {
        restaurant_name: order.restaurantName,
        order_items: order.items,
        delivery_address: order.deliveryAddress,
        customer_name: order.customerName,
        customer_phone: formatPhone(order.customerPhone),
        payment_method: paymentMethodForAgent(order.paymentMethod),
        max_budget: String(order.budgetCzk),
      },
    });
    await sql`
      UPDATE orders SET status = 'calling', el_status = 'initiated', conversation_id = ${call.conversationId},
        call_sid = ${call.callSid}, last_synced_at = now(), updated_at = now()
      WHERE id = ${orderId} AND status = 'dialing'`;
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A 4xx (or success=false) answer means ElevenLabs placed no call, so it does not use up
    // one of the day's calls. Timeouts and 5xx are ambiguous and stay counted.
    const status = error instanceof ElevenLabsError ? error.status : null;
    const noCallPlaced = status !== null && status < 500;
    await sql`
      UPDATE orders SET status = 'failed', error = ${message}, updated_at = now(),
        call_started_at = CASE WHEN ${noCallPlaced}::boolean THEN NULL ELSE call_started_at END
      WHERE id = ${orderId}`;
    return fail(message);
  }
}

async function markFailed(orderId: string, message: string): Promise<void> {
  await sql`
    UPDATE orders SET status = 'failed', error = ${message}, updated_at = now()
    WHERE id = ${orderId} AND status IN ('dialing', 'calling', 'processing')`;
}

async function applyConversation(order: Order, conversation: Conversation): Promise<void> {
  const transcript = JSON.stringify(toTranscript(conversation));
  switch (conversation.status) {
    case "initiated":
    case "in-progress":
      if (minutesSince(order.callStartedAt) > STUCK_CALL_MINUTES) {
        await markFailed(order.id, "The call ran far longer than allowed and was closed by Jarvis Food.");
        return;
      }
      await sql`
        UPDATE orders SET status = 'calling', el_status = ${conversation.status}, transcript = ${transcript}::jsonb,
          last_synced_at = now(), updated_at = now()
        WHERE id = ${order.id} AND status = 'calling'`;
      return;
    case "processing":
      if (minutesSince(order.callStartedAt) > STUCK_CALL_MINUTES * 2) {
        await markFailed(order.id, "ElevenLabs never finished analysing the call. Check the transcript.");
        return;
      }
      await sql`
        UPDATE orders SET status = 'processing', el_status = 'processing', transcript = ${transcript}::jsonb,
          last_synced_at = now(), updated_at = now()
        WHERE id = ${order.id} AND status IN ('calling', 'processing')`;
      return;
    case "done": {
      const r = extractResults(conversation);
      const finalStatus = r.orderConfirmed === true ? "confirmed" : "not_confirmed";
      await sql`
        UPDATE orders SET status = ${finalStatus}, el_status = 'done', transcript = ${transcript}::jsonb,
          order_confirmed = ${r.orderConfirmed}, total_czk = ${r.totalCzk}, eta_minutes = ${r.etaMinutes},
          notes = ${r.notes}, summary = ${r.summary}, call_ended_at = ${r.callEndedAt},
          last_synced_at = now(), updated_at = now()
        WHERE id = ${order.id} AND status IN ('calling', 'processing')`;
      return;
    }
    case "failed":
      await sql`
        UPDATE orders SET status = 'failed', el_status = 'failed', transcript = ${transcript}::jsonb,
          error = ${describeFailure(conversation)}, last_synced_at = now(), updated_at = now()
        WHERE id = ${order.id} AND status IN ('calling', 'processing')`;
      return;
  }
}

/**
 * Pulls the latest call state from ElevenLabs into the database (polling, no webhooks needed).
 * Returns the fresh order. Throttled so several open tabs don't hammer the API.
 */
export async function syncOrder(order: Order, options: { force?: boolean } = {}): Promise<Order> {
  if (order.status === "dialing") {
    // Only possible if the server died between claiming the order and ElevenLabs answering.
    if (minutesSince(order.callStartedAt) > 2) await markFailed(order.id, "The call could not be started (timed out).");
    return (await getOrder(order.id)) ?? order;
  }
  if ((order.status !== "calling" && order.status !== "processing") || !order.conversationId) return order;
  if (!options.force && order.lastSyncedAt && Date.now() - new Date(order.lastSyncedAt).getTime() < 1500) {
    return order;
  }

  try {
    await applyConversation(order, await getConversation(order.conversationId));
  } catch (error) {
    if (minutesSince(order.callStartedAt) > STUCK_CALL_MINUTES * 2) {
      await markFailed(order.id, `Lost contact with ElevenLabs: ${error instanceof Error ? error.message : String(error)}`);
    } else {
      // Transient API error: keep the order as is and try again on the next poll.
      return order;
    }
  }
  const [row] = await sql<OrderRow>`SELECT * FROM orders WHERE id = ${order.id}`;
  return row ? toOrder(row) : order;
}

export async function syncActiveOrders(): Promise<void> {
  for (const order of await listActiveOrders()) {
    await syncOrder(order, { force: true });
  }
}
