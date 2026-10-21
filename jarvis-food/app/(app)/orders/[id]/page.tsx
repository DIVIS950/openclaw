import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelDraftAction, reorderAction, startCallAction } from "@/app/actions/orders";
import { StatusPill } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";
import { Transcript } from "@/components/Transcript";
import { requireSession } from "@/lib/auth";
import { syncOrder } from "@/lib/calls";
import { etaClock, formatCzk, formatDateTime } from "@/lib/format";
import { DRAFT_TTL_MINUTES, MAX_CALLS_PER_DAY } from "@/lib/limits";
import { callsToday, getOrder, type Order } from "@/lib/orders";
import { formatPhone } from "@/lib/phone";
import { paymentMethodLabel } from "@/lib/settings";
import { ConfirmCall } from "./ConfirmCall";
import { LiveCall } from "./LiveCall";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const found = await getOrder(id);
  if (!found) notFound();
  const order = await syncOrder(found);

  switch (order.status) {
    case "draft":
      return <Summary order={order} used={await callsToday()} />;
    case "dialing":
    case "calling":
    case "processing":
      return <LiveCall initialOrder={order} />;
    case "cancelled":
      return (
        <>
          <header className="header">
            <h1 className="title">Cancelled</h1>
            <p className="subtitle">This summary was cancelled or replaced. Nothing was called.</p>
          </header>
          <Link href="/" className="btn btn-primary btn-big">
            New order
          </Link>
        </>
      );
    default:
      return <Result order={order} />;
  }
}

function OrderDetails({ order }: { order: Order }) {
  return (
    <dl className="card kv">
      <div>
        <dt>Restaurant</dt>
        <dd>
          <strong>{order.restaurantName}</strong>
          <br />
          <span className="muted">{formatPhone(order.restaurantPhone)}</span>
        </dd>
      </div>
      <div>
        <dt>Order</dt>
        <dd className="prewrap">{order.items}</dd>
      </div>
      <div>
        <dt>Max total</dt>
        <dd>{formatCzk(order.budgetCzk)}</dd>
      </div>
      <div>
        <dt>Deliver to</dt>
        <dd className="prewrap">{order.deliveryAddress}</dd>
      </div>
      <div>
        <dt>For</dt>
        <dd>
          {order.customerName} · <span className="nowrap">{formatPhone(order.customerPhone)}</span>
        </dd>
      </div>
      <div>
        <dt>Payment</dt>
        <dd>{paymentMethodLabel(order.paymentMethod)} on delivery</dd>
      </div>
    </dl>
  );
}

function Summary({ order, used }: { order: Order; used: number }) {
  const expired = Date.now() - new Date(order.createdAt).getTime() > DRAFT_TTL_MINUTES * 60_000;
  const limitReached = used >= MAX_CALLS_PER_DAY;
  return (
    <>
      <header className="header">
        <p className="eyebrow">Summary</p>
        <h1 className="title">Ready to call?</h1>
        <p className="subtitle">Check everything. Jarvis calls only after you tap “Yes, call”.</p>
      </header>

      <OrderDetails order={order} />

      <ul className="card rules">
        <li>Speaks Czech, switches to English if the staff do, and says it is an AI.</li>
        <li>Orders only these items. No extras, no upsells.</li>
        <li>Cancels if the total is over {formatCzk(order.budgetCzk)}, they are closed, or they don’t deliver to you.</li>
        <li>Never gives card or bank details. You pay on delivery.</li>
      </ul>

      {expired ? (
        <p className="msg msg-error">This summary is older than {DRAFT_TTL_MINUTES} minutes. Tap Edit to review it again.</p>
      ) : limitReached ? (
        <p className="msg msg-error">Daily limit reached ({MAX_CALLS_PER_DAY} calls). Try again tomorrow.</p>
      ) : (
        <ConfirmCall action={startCallAction.bind(null, order.id)} callsLeft={MAX_CALLS_PER_DAY - used} />
      )}

      <div className="row">
        <Link href={`/?edit=${order.id}`} className="btn btn-secondary">
          Edit
        </Link>
        <form action={cancelDraftAction.bind(null, order.id)} className="grow">
          <SubmitButton className="btn btn-ghost" pendingLabel="Cancelling…">
            Cancel
          </SubmitButton>
        </form>
      </div>
    </>
  );
}

function Result({ order }: { order: Order }) {
  const tone = order.status === "confirmed" ? "ok" : order.status === "failed" ? "warn" : "bad";
  const heading =
    order.status === "confirmed" ? "Order confirmed" : order.status === "failed" ? "Call failed" : "Not confirmed";
  const arrival = etaClock(order.callEndedAt, order.etaMinutes);
  const overBudget = order.totalCzk !== null && order.totalCzk > order.budgetCzk;

  return (
    <>
      <header className="header result-header">
        <div className={`result-badge result-${tone}`} aria-hidden="true">
          {tone === "ok" ? "✓" : tone === "warn" ? "!" : "✕"}
        </div>
        <h1 className="title center">{heading}</h1>
        <p className="subtitle center">
          {order.restaurantName} · {formatDateTime(order.callStartedAt ?? order.createdAt)}
        </p>
      </header>

      {order.status !== "failed" ? (
        <div className="stats">
          <div className={overBudget ? "stat stat-warn" : "stat"}>
            <span className="stat-label">Total</span>
            <span className="stat-value">{order.totalCzk !== null ? formatCzk(order.totalCzk) : "—"}</span>
            {overBudget ? <span className="stat-hint">Over your {formatCzk(order.budgetCzk)} budget!</span> : null}
          </div>
          <div className="stat">
            <span className="stat-label">Delivery</span>
            <span className="stat-value">{order.etaMinutes !== null ? `~${order.etaMinutes} min` : "—"}</span>
            {arrival ? <span className="stat-hint">around {arrival}</span> : null}
          </div>
        </div>
      ) : null}

      {order.error ? <p className="msg msg-error">{order.error}</p> : null}
      {order.notes ? (
        <div className="card">
          <p className="label">Notes</p>
          <p className="prewrap">{order.notes}</p>
        </div>
      ) : null}
      {order.summary ? (
        <div className="card">
          <p className="label">Call summary</p>
          <p className="prewrap">{order.summary}</p>
        </div>
      ) : null}

      <form action={reorderAction.bind(null, order.id)}>
        <SubmitButton className="btn btn-primary btn-big" pendingLabel="Preparing…">
          Re-order
        </SubmitButton>
      </form>
      <a href={`tel:${order.restaurantPhone}`} className="btn btn-secondary">
        Call the restaurant yourself
      </a>

      <details className="card" open={order.status !== "confirmed"}>
        <summary className="details-summary">
          <span>
            Transcript <span className="muted">({order.transcript.length} lines)</span>
          </span>
        </summary>
        <Transcript lines={order.transcript} />
      </details>

      <details className="card">
        <summary className="details-summary">
          <span>
            Order details <StatusPill status={order.status} />
          </span>
        </summary>
        <OrderDetails order={order} />
      </details>
    </>
  );
}
