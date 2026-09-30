"use client";

import { ArrowLeft, Check, ExternalLink, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OrderPlaced } from "@/components/OrderPlaced";
import { BoardingPass } from "@/components/BoardingPass";
import { RoadTrip } from "@/components/RoadTrip";
import { WorldMap } from "@/components/WorldMap";
import { cn, money } from "@/lib/format";
import { findPlace } from "@/lib/geo";
import { carrierTrackingUrl, STATUS_LABEL, type OrderStatus, type PublicOrder } from "@/lib/order-types";
import { makeParcel, parcelProgress } from "@/lib/parcels";
import { useAppState } from "@/lib/store";

const STEPS: { status: OrderStatus; label: string; hint: string }[] = [
  { status: "held", label: "Payment reserved", hint: "Your card is not charged yet." },
  { status: "ordered", label: "Ordered from the shop", hint: "We bought it for you and charged your card." },
  { status: "shipped", label: "On the way", hint: "The shop handed it to the carrier." },
  { status: "delivered", label: "Delivered", hint: "Enjoy!" },
];
const RANK: Record<OrderStatus, number> = { pending_payment: -1, held: 0, ordered: 1, shipped: 2, delivered: 3, cancelled: -2 };

export function OrderView({ id }: { id: string }) {
  const { myOrders } = useAppState();
  const ref = myOrders.find((o) => o.id === id);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState("");
  const params = useSearchParams();
  const router = useRouter();
  const justPlaced = params.get("placed") === "1";

  useEffect(() => {
    if (!ref) return;
    let alive = true;
    const load = () =>
      fetch(`/api/orders/${encodeURIComponent(id)}`, { headers: { "x-order-token": ref.token } })
        .then(async (r) => {
          if (!r.ok) throw new Error();
          const o = (await r.json()) as PublicOrder;
          if (alive) setOrder(o);
        })
        .catch(() => alive && setError("Couldn't load this order right now."));
    void load();
    // Keep the status fresh while the page is open.
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, ref]);

  const parcel = useMemo(() => {
    if (!order || (order.status !== "shipped" && order.status !== "delivered")) return null;
    const from = findPlace(order.item.fromCity);
    const to = findPlace(order.address.city);
    const shippedAt = order.events.find((e) => e.status === "shipped")?.at;
    if (!from || !to || !shippedAt) return null;
    const p = makeParcel({ title: `${order.item.brand} ${order.item.title}`, store: order.item.store, carrier: order.carrier ?? order.delivery.carrier, from, to, mode: order.delivery.mode, maxDays: order.delivery.maxDays, shippedAt });
    return { ...p, trackingNumber: order.trackingNumber ?? p.trackingNumber };
  }, [order]);

  if (!ref) {
    return (
      <Empty>
        This order isn&apos;t saved on this device. Open it on the phone or computer you ordered from, or check your email.
      </Empty>
    );
  }
  if (!order) return error ? <Empty>{error}</Empty> : <div className="shimmer mx-auto mt-10 h-64 max-w-2xl rounded-2xl" />;

  const rank = RANK[order.status];
  const progress = parcel ? (order.status === "delivered" ? 1 : Math.min(0.97, parcelProgress(parcel))) : 0;
  const trackUrl = order.trackingNumber && order.carrier ? carrierTrackingUrl(order.carrier, order.trackingNumber) : undefined;

  return (
    <div className="mx-auto max-w-3xl pb-10">
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} /> Your orders
      </Link>
      <div className="mt-2 text-sm font-semibold uppercase tracking-wider text-accent-ink">{STATUS_LABEL[order.status]}</div>
      <h1 className="font-serif text-3xl font-bold tracking-tight">
        {order.item.brand} {order.item.title}
      </h1>
      <p className="text-sm text-muted">
        from {order.item.store} · order {order.id}
      </p>

      {justPlaced && order.status !== "cancelled" && (
        <OrderPlaced title={`${order.item.brand} ${order.item.title}`} store={order.item.store} onDismiss={() => router.replace(`/order/${id}`)} />
      )}

      {order.status === "cancelled" ? (
        <div className="card mt-5 flex gap-3 border-bad/40 p-4">
          <XCircle className="shrink-0 text-bad" />
          <div>
            <div className="font-semibold">Order cancelled. You weren&apos;t charged.</div>
            <div className="text-sm text-muted">{order.events.at(-1)?.note ?? "The reserved money was released back to your card."}</div>
          </div>
        </div>
      ) : order.status === "pending_payment" ? (
        <div className="card mt-5 p-4 text-sm text-muted">We&apos;re waiting for your payment to be confirmed. This usually takes a few seconds.</div>
      ) : (
        <ol className="card mt-5 space-y-0 p-5">
          {STEPS.map((s, i) => {
            const done = rank >= i;
            const at = order.events.find((e) => e.status === s.status)?.at;
            return (
              <li key={s.status} className="relative flex gap-4 pb-5 last:pb-0">
                {i < STEPS.length - 1 && <span className={cn("absolute left-[11px] top-6 h-full w-0.5", rank > i ? "bg-accent" : "bg-line")} />}
                <span className={cn("relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2", done ? "border-accent bg-accent text-white" : "border-line bg-surface")}>
                  {done && <Check size={13} strokeWidth={3} />}
                </span>
                <div className={cn(!done && "opacity-50")}>
                  <div className="font-medium">{s.label}</div>
                  <div className="text-sm text-muted">
                    {at ? new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " · " : ""}
                    {s.hint}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {parcel && (
        <div className="mt-5 space-y-4">
          <WorldMap parcel={parcel} progress={progress} />
          {parcel.mode === "air" ? <BoardingPass parcel={parcel} progress={progress} eta={parcel.promisedBy} /> : <RoadTrip parcel={parcel} progress={progress} eta={parcel.promisedBy} />}
          <p className="text-xs text-muted">The map shows an estimate from the shipping date. The carrier&apos;s page has the exact scans.</p>
        </div>
      )}

      {order.trackingNumber && (
        <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">{order.carrier}</div>
            <div className="font-mono font-semibold">{order.trackingNumber}</div>
          </div>
          {trackUrl && (
            <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost h-10 px-4 text-sm">
              <ExternalLink size={15} /> Track at {order.carrier}
            </a>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="card p-4 text-sm">
          <div className="mb-1 font-semibold">Delivery to</div>
          <div>{order.customer.name}</div>
          <div className="text-muted">
            {order.address.line1}, {order.address.zip} {order.address.city}
          </div>
          <div className="mt-2 text-muted">
            {order.delivery.label} with {order.delivery.carrier}
          </div>
        </div>
        <div className="card space-y-1 p-4 text-sm">
          <div className="mb-1 font-semibold">Payment</div>
          <Line label="Reserved" value={money(order.authorized)} />
          {order.charged !== undefined && <Line label="Charged" value={money(order.charged)} strong />}
          {order.charged !== undefined && order.charged < order.authorized && (
            <p className="text-ok">You saved {money(order.authorized - order.charged)}. The rest was released.</p>
          )}
          {order.coupon && <p className="text-muted">Coupon tried: {order.coupon.code}</p>}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={cn("tabular-nums", strong && "font-semibold")}>{value}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-24 text-center text-muted">
      <p>{children}</p>
      <Link href="/orders" className="btn btn-primary mt-4 px-5 py-2">
        Your orders
      </Link>
    </div>
  );
}
