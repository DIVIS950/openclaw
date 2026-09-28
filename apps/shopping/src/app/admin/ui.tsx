"use client";

import { Check, Copy, ExternalLink, TriangleAlert } from "lucide-react";
import { startTransition, useActionState, useState } from "react";
import { cn } from "@/lib/format";
import type { PublicOrder } from "@/lib/order-types";
import { cancelOrder, login, markDelivered, markOrdered, markShipped, type ActionResult } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="mx-auto mt-20 max-w-sm space-y-3">
      <h1 className="font-serif text-2xl font-bold">Orbit admin</h1>
      <label htmlFor="admin-password" className="block text-sm text-muted">
        Password
      </label>
      <input id="admin-password" name="password" type="password" autoComplete="current-password" required className="field" />
      {state && !state.ok && <p className="text-sm text-bad">{state.message}</p>}
      <button disabled={pending} className="btn btn-primary h-11 w-full">
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}

const DAY = 864e5;

export function AdminOrderCard({ order, statusLabel }: { order: PublicOrder; statusLabel: string }) {
  const age = (Date.now() - order.createdAt) / DAY;
  const address = `${order.customer.name}\n${order.address.line1}\n${order.address.zip} ${order.address.city}\n${order.address.country}\n${order.customer.phone}`;
  return (
    <article className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent-ink">
            {statusLabel} · {order.id}
          </div>
          <div className="text-lg font-semibold">
            {order.item.brand} {order.item.title}
          </div>
          <div className="text-sm text-muted">
            {order.item.store} ({order.item.domain}) · quoted {order.item.price.toFixed(2)} EUR · {order.delivery.label} ({order.delivery.carrier})
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold tabular-nums">{(order.charged ?? order.authorized).toFixed(2)} EUR</div>
          <div className="text-xs text-muted">{order.charged !== undefined ? "charged" : `reserved · fee ${order.fee.toFixed(2)}`}</div>
        </div>
      </div>

      {order.status === "held" && age > 5 && (
        <p className="flex items-center gap-1.5 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          <TriangleAlert size={15} /> Reserved {Math.floor(age)} days ago. Card holds usually expire after 7 days, so place it today or cancel.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">Ship to</span>
            <CopyButton text={address} label="Copy address" />
          </div>
          <pre className="whitespace-pre-wrap font-sans">{address}</pre>
          <div className="mt-1 text-muted">{order.customer.email}</div>
        </div>
        <div className="space-y-2 text-sm">
          {order.item.url ? (
            <a href={order.item.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost h-10 w-full justify-start px-3">
              <ExternalLink size={15} /> Open product at {order.item.domain}
            </a>
          ) : (
            <a href={`https://${order.item.domain}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost h-10 w-full justify-start px-3">
              <ExternalLink size={15} /> Open {order.item.domain} and search for it
            </a>
          )}
          {order.coupon && (
            <div className="flex items-center justify-between rounded-xl border border-dashed border-ok px-3 py-2">
              <span>
                Try coupon <b className="font-mono">{order.coupon.code}</b>
              </span>
              <CopyButton text={order.coupon.code} label="Copy" />
            </div>
          )}
          {order.shopOrderNumber && <div>Shop order: {order.shopOrderNumber}</div>}
          {order.trackingNumber && (
            <div>
              Tracking: {order.carrier} {order.trackingNumber}
            </div>
          )}
        </div>
      </div>

      {order.status === "held" && (
        <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-[1fr_auto]">
          <ActionForm action={markOrdered} id={order.id} submit="Placed at shop · charge customer">
            <input name="shopOrderNumber" placeholder="Shop's order number" className="field" required aria-label="Shop order number" />
            <input
              name="finalAmount"
              inputMode="decimal"
              placeholder={`Final total (max ${order.authorized.toFixed(2)})`}
              className="field"
              aria-label="Final amount to charge"
            />
          </ActionForm>
          <ActionForm action={cancelOrder} id={order.id} submit="Cancel · release money" danger>
            <input name="reason" placeholder="Reason (e.g. sold out)" className="field" aria-label="Cancel reason" />
          </ActionForm>
        </div>
      )}
      {order.status === "pending_payment" && (
        <div className="border-t border-line pt-3">
          <ActionForm action={cancelOrder} id={order.id} submit="Cancel" danger />
        </div>
      )}
      {order.status === "ordered" && (
        <div className="border-t border-line pt-3">
          <ActionForm action={markShipped} id={order.id} submit="Mark shipped">
            <input name="carrier" placeholder={`Carrier (${order.delivery.carrier})`} className="field" aria-label="Carrier" />
            <input name="trackingNumber" placeholder="Tracking number" className="field" required aria-label="Tracking number" />
          </ActionForm>
        </div>
      )}
      {order.status === "shipped" && (
        <div className="border-t border-line pt-3">
          <ActionForm action={markDelivered} id={order.id} submit="Mark delivered" />
        </div>
      )}
    </article>
  );
}

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

function ActionForm({ action, id, submit, danger, children }: { action: Action; id: string; submit: string; danger?: boolean; children?: React.ReactNode }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form
      // Submitting via onSubmit (not the form action prop) keeps what was typed
      // when the server says no, instead of React clearing the fields.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={id} />
      {children}
      <button disabled={pending} className={cn("btn h-10 px-4 text-sm", danger ? "btn-ghost text-bad" : "btn-primary")}>
        {pending ? "Working…" : submit}
      </button>
      {state && <p className={cn("text-sm", state.ok ? "text-ok" : "text-bad")}>{state.message}</p>}
    </form>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => {});
      }}
      className="inline-flex items-center gap-1 text-xs font-semibold text-accent-ink"
    >
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copied" : label}
    </button>
  );
}
