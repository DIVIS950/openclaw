import type { Metadata } from "next";
import { STATUS_LABEL, type Order, type OrderStatus } from "@/lib/order-types";
import { adminConfigured, isAdmin } from "@/lib/server/admin-auth";
import { dbConfigured, orders } from "@/lib/server/orders-db";
import { stripeConfigured } from "@/lib/server/stripe";
import { logout } from "./actions";
import { AdminOrderCard, LoginForm } from "./ui";

export const metadata: Metadata = { title: "Orbit admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const GROUPS: { title: string; hint: string; statuses: OrderStatus[] }[] = [
  { title: "Needs you", hint: "Payment reserved. Buy it at the shop, then enter the shop's order number to charge the customer.", statuses: ["held"] },
  { title: "Ordered", hint: "Waiting for the shop to ship. Add the tracking number when you get it.", statuses: ["ordered"] },
  { title: "On the way", hint: "Mark as delivered when the carrier confirms.", statuses: ["shipped"] },
  { title: "Waiting for the customer's payment", hint: "Checkout started but not approved yet.", statuses: ["pending_payment"] },
  { title: "Done", hint: "", statuses: ["delivered", "cancelled"] },
];

export default async function AdminPage() {
  if (!adminConfigured()) {
    return (
      <Setup>
        Set <code>ADMIN_PASSWORD</code> and <code>AUTH_SECRET</code> in your hosting settings to turn on the admin page.
      </Setup>
    );
  }
  if (!(await isAdmin())) return <LoginForm />;
  if (!dbConfigured || !stripeConfigured) {
    return (
      <Setup>
        Orders need a database and Stripe. Add <code>UPSTASH_REDIS_REST_URL</code>, <code>UPSTASH_REDIS_REST_TOKEN</code>, <code>STRIPE_SECRET_KEY</code> and{" "}
        <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> (see DEPLOY.md).
      </Setup>
    );
  }

  const all = await orders().list();
  const reserved = all.filter((o) => o.status === "held").reduce((s, o) => s + o.authorized, 0);

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight">Orders</h1>
          <p className="text-sm text-muted">
            {all.length} total · {reserved.toFixed(2)} EUR reserved and waiting for you
          </p>
        </div>
        <form action={logout}>
          <button className="btn btn-ghost h-10 px-4 text-sm">Sign out</button>
        </form>
      </div>

      {GROUPS.map((g) => {
        const rows = all.filter((o) => g.statuses.includes(o.status));
        if (!rows.length) return null;
        return (
          <section key={g.title} className="mt-8">
            <h2 className="font-serif text-xl font-bold">
              {g.title} <span className="text-muted">({rows.length})</span>
            </h2>
            {g.hint && <p className="mb-3 text-sm text-muted">{g.hint}</p>}
            <div className="space-y-3">
              {rows.map((o) => (
                <AdminOrderCard key={o.id} order={toAdminView(o)} statusLabel={STATUS_LABEL[o.status]} />
              ))}
            </div>
          </section>
        );
      })}
      {!all.length && <p className="mt-16 text-center text-muted">No orders yet.</p>}
    </div>
  );
}

/** Everything the admin card shows; payment ids stay on the server. */
function toAdminView(o: Order) {
  const { token: _t, paymentIntentId: _p, ...rest } = o;
  return rest;
}

function Setup({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="font-serif text-2xl font-bold">Admin</h1>
      <p className="mt-3 text-muted [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:text-ink">{children}</p>
    </div>
  );
}
