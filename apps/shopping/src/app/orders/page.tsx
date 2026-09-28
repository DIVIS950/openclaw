"use client";

import { ChevronRight, ExternalLink, Mail, Package, Plane, RefreshCw, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useEnv, useUser } from "@/components/Providers";
import { cn } from "@/lib/format";
import { findPlace } from "@/lib/geo";
import { carrierTrackingUrl, STATUS_LABEL, type PublicOrder } from "@/lib/order-types";
import { demoParcels, parcelProgress, parcelStatus } from "@/lib/parcels";
import { setAppState, useAppState } from "@/lib/store";

const STATIC = process.env.NEXT_PUBLIC_ORBIT_STATIC === "1";

type MailParcel = { carrier: string; trackingNumber: string; subject: string; from: string };

export default function OrdersPage() {
  const { myOrders } = useAppState();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mt-2 font-serif text-3xl font-bold tracking-tight">Orders &amp; parcels</h1>

      {myOrders.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Bought with Orbit</h2>
          <div className="space-y-3">
            {myOrders.map((o) => (
              <OrderRow key={o.id} id={o.id} token={o.token} title={o.title} />
            ))}
          </div>
        </section>
      )}

      {STATIC ? <ExampleParcels /> : <GmailParcels />}
    </div>
  );
}

function OrderRow({ id, token, title }: { id: string; token: string; title: string }) {
  const [order, setOrder] = useState<PublicOrder | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/orders/${encodeURIComponent(id)}`, { headers: { "x-order-token": token } })
      .then((r) => (r.ok ? r.json() : null))
      .then((o: PublicOrder | null) => alive && o && setOrder(o))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, token]);
  return (
    <Link href={`/order/${id}`} className="card flex items-center gap-4 p-4 transition hover:border-accent/50">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent-ink">
        <Package size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className={cn("text-sm", order?.status === "cancelled" ? "text-bad" : "text-muted")}>{order ? STATUS_LABEL[order.status] : "Loading…"}</div>
      </div>
      <ChevronRight size={18} className="text-muted" />
    </Link>
  );
}

/** Real parcels found in the signed-in user's Gmail (read-only). */
function GmailParcels() {
  const { gmailEnabled, googleEnabled } = useEnv();
  const user = useUser();
  const [items, setItems] = useState<MailParcel[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function sync() {
    setBusy(true);
    setNote("");
    try {
      const r = await fetch("/api/gmail/parcels");
      const data = (await r.json()) as { parcels?: MailParcel[]; error?: string };
      if (!r.ok) throw new Error(data.error);
      setItems(data.parcels ?? []);
      setAppState({ gmailConnected: true });
    } catch (e) {
      setNote(e instanceof Error && e.message ? e.message : "Couldn't read Gmail. Try signing in again.");
    } finally {
      setBusy(false);
    }
  }

  const canUse = gmailEnabled && user?.kind === "google";
  return (
    <section className="mt-8">
      <div className="card flex items-center gap-4 p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <Mail size={20} />
        </span>
        <div className="flex-1">
          <div className="font-medium">Parcels from other shops</div>
          <div className="text-sm text-muted">
            {canUse
              ? "Orbit reads your shipping emails (read-only) and lists the tracking numbers."
              : gmailEnabled || googleEnabled
                ? "Sign in with Google to find tracking numbers in your shipping emails."
                : "Gmail tracking turns on when the owner adds Google sign-in."}
          </div>
        </div>
        {canUse ? (
          <button onClick={sync} disabled={busy} className="btn btn-primary h-10 shrink-0 px-4 text-sm">
            <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> {items ? "Sync" : "Check Gmail"}
          </button>
        ) : googleEnabled ? (
          <Link href="/signin" className="btn btn-primary h-10 shrink-0 px-4 text-sm">
            Sign in
          </Link>
        ) : null}
      </div>
      {note && <p className="mt-2 text-sm text-bad">{note}</p>}
      {items && (
        <div className="mt-3 space-y-2">
          {items.length === 0 && <p className="text-sm text-muted">No tracking numbers in the last 30 days of email.</p>}
          {items.map((p) => {
            const url = carrierTrackingUrl(p.carrier, p.trackingNumber);
            return (
              <div key={p.trackingNumber} className="card flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.subject || p.from}</div>
                  <div className="font-mono text-xs text-muted">
                    {p.carrier} · {p.trackingNumber}
                  </div>
                </div>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost h-9 px-3 text-xs">
                    <ExternalLink size={13} /> Track
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Preview build only: example parcels to show the tracking screens. */
function ExampleParcels() {
  const { orders, address } = useAppState();
  const [busy, setBusy] = useState(false);
  return (
    <section className="mt-8">
      <div className="card flex items-center gap-4 p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <Mail size={20} />
        </span>
        <div className="flex-1">
          <div className="font-medium">Track everything from Gmail</div>
          <div className="text-sm text-muted">In this preview, Connect adds example parcels so you can see the tracking screens.</div>
        </div>
        <button
          onClick={async () => {
            setBusy(true);
            await new Promise((r) => setTimeout(r, 600));
            const home = findPlace(address.city)?.city ?? "Prague";
            setAppState((s) => ({ gmailConnected: true, orders: [...s.orders.filter((o) => o.source !== "gmail"), ...demoParcels(home)] }));
            setBusy(false);
          }}
          disabled={busy}
          className="btn btn-primary h-10 shrink-0 px-4 text-sm"
        >
          {busy && <RefreshCw size={15} className="animate-spin" />} Connect
        </button>
      </div>
      <div className="mt-4 space-y-3">
        {orders.length === 0 && (
          <div className="py-14 text-center text-muted">
            <Package className="mx-auto mb-3" size={36} strokeWidth={1.4} />
            No parcels yet.
          </div>
        )}
        {orders.map((p) => (
          <Link key={p.id} href={`/track/${p.id}`} className="card flex items-center gap-4 p-4 transition hover:border-accent/50">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-2">{p.mode === "air" ? <Plane size={20} /> : <Truck size={20} />}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.title}</div>
              <div className="truncate text-sm text-muted">
                {parcelStatus(p)} · {p.from.city} → {p.to.city}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(3, parcelProgress(p) * 100)}%` }} />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
