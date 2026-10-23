import Link from "next/link";
import { reorderAction } from "@/app/actions/orders";
import { StatusPill } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";
import { requireSession } from "@/lib/auth";
import { syncActiveOrders } from "@/lib/calls";
import { formatCzk, formatDateTime } from "@/lib/format";
import { listHistory } from "@/lib/orders";

export default async function HistoryPage() {
  await requireSession();
  await syncActiveOrders();
  const orders = await listHistory();

  return (
    <>
      <header className="header">
        <p className="eyebrow">History</p>
        <h1 className="title">Past orders</h1>
      </header>

      {orders.length === 0 ? (
        <div className="card empty">
          <p>No calls yet.</p>
          <Link href="/" className="btn btn-primary">
            Order something
          </Link>
        </div>
      ) : (
        <ul className="list">
          {orders.map((order) => (
            <li key={order.id} className="card list-item">
              <Link href={`/orders/${order.id}`} className="list-link">
                <div className="list-top">
                  <strong className="ellipsis">{order.restaurantName}</strong>
                  <StatusPill status={order.status} />
                </div>
                <p className="muted small ellipsis">{order.items.replace(/\s*\n\s*/g, ", ")}</p>
                <p className="muted small">
                  {formatDateTime(order.callStartedAt ?? order.createdAt)}
                  {order.totalCzk !== null ? ` · ${formatCzk(order.totalCzk)}` : ""}
                  {order.etaMinutes !== null ? ` · ~${order.etaMinutes} min` : ""}
                </p>
              </Link>
              <form action={reorderAction.bind(null, order.id)}>
                <SubmitButton className="btn btn-secondary btn-small" pendingLabel="…">
                  Re-order
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small center">Re-order opens the summary. Pineapple still waits for your “Yes, call”.</p>
    </>
  );
}
