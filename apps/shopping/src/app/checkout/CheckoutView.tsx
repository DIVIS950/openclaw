"use client";

import { BadgePercent, Info, MapPin, Plane, ShieldCheck, Truck, User } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useEnv, useUser } from "@/components/Providers";
import { StripePay, type CreatedOrder } from "@/components/StripePay";
import { ProductArt } from "@/components/ui";
import { getOffer, getProduct, getStore } from "@/lib/data";
import { arrivalWindow, money } from "@/lib/format";
import { PLACES } from "@/lib/geo";
import { OrderInput, priceOrder } from "@/lib/order-pricing";
import { assessStore } from "@/lib/safety";
import { setAppState, useAppState, type Address } from "@/lib/store";

type Speed = "economy" | "standard" | "express" | "sameday";

export function CheckoutView() {
  const params = useSearchParams();
  const router = useRouter();
  const offer = getOffer(params.get("offer") ?? "");
  const user = useUser();
  const env = useEnv();
  const { address, pendingCoupon } = useAppState();
  const [addr, setAddr] = useState<Address>(address);
  const [email, setEmail] = useState("");

  // Prefill from the saved profile and the Google account.
  useEffect(() => {
    setAddr((a) => ({ ...address, name: address.name || a.name || user?.name || "" }));
    setEmail((e) => e || user?.email || "");
  }, [address, user?.name, user?.email]);

  if (!offer) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted">That offer is no longer available.</p>
        <Link href="/search" className="btn btn-primary mt-4 px-5 py-2">
          Search again
        </Link>
      </div>
    );
  }

  const product = getProduct(offer.productId)!;
  const store = getStore(offer.storeId)!;
  const safety = assessStore(store, offer.price, product.typicalPrice);
  const coupon = pendingCoupon?.offerId === offer.id ? { code: pendingCoupon.code, description: pendingCoupon.description } : undefined;

  const input = {
    customer: { name: addr.name, email, phone: addr.phone },
    address: { line1: addr.line1, city: addr.city, zip: addr.zip, country: addr.country || "Czechia" },
    item: {
      productId: product.id,
      offerId: offer.id,
      title: product.title,
      brand: product.brand,
      store: store.name,
      domain: store.domain,
      url: offer.url,
      price: offer.price,
      fromCity: store.warehouse.city,
    },
    speed: (params.get("speed") ?? "standard") as Speed,
    coupon,
  };
  // The same pricing code the server runs, so the amount shown is the amount reserved.
  const priced = priceOrder({ ...input, speed: input.speed } as OrderInput, env.feePercent);

  async function createOrder(): Promise<CreatedOrder | string> {
    const check = OrderInput.safeParse(input);
    if (!check.success) {
      const field = check.error.issues[0]?.path.slice(-1)[0];
      return `Please check your ${field === "line1" ? "street" : String(field ?? "details")}.`;
    }
    if (safety.level === "danger") return "Orbit doesn't buy from shops that look like scams.";
    setAppState({ address: addr });
    const res = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(check.data) });
    const data = (await res.json().catch(() => ({}))) as Partial<CreatedOrder> & { error?: string };
    if (!res.ok || !data.id || !data.token || !data.clientSecret) return data.error ?? "Couldn't start the order. Try again.";
    // Keep the order's key on this device before paying, so redirects can find it.
    setAppState((s) => ({ myOrders: [{ id: data.id!, token: data.token!, title: `${product.brand} ${product.title}`, createdAt: Date.now() }, ...s.myOrders], pendingCoupon: null }));
    return data as CreatedOrder;
  }

  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setAddr({ ...addr, [k]: e.target.value });

  return (
    <div className="mx-auto grid max-w-5xl gap-6 pb-10 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0">
        <h1 className="mt-2 font-serif text-3xl font-bold tracking-tight">Checkout</h1>
        <p className="mt-1 text-sm text-muted">Orbit buys it from {store.name} for you and has it delivered to your door.</p>

        <section className="card mt-5 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <User size={17} className="text-accent" /> Contact
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Field id="co-name" label="Full name" value={addr.name} onChange={set("name")} autoComplete="name" />
            <Field id="co-email" label="Email for updates" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" type="email" />
            <Field id="co-phone" label="Phone for the courier" value={addr.phone} onChange={set("phone")} autoComplete="tel" type="tel" />
          </div>
        </section>

        <section className="card mt-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <MapPin size={17} className="text-accent" /> Delivery address
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field id="co-street" label="Street and number" value={addr.line1} onChange={set("line1")} autoComplete="address-line1" />
            </div>
            <div>
              <label htmlFor="co-city" className="mb-1 block text-xs font-medium text-muted">
                City
              </label>
              <select id="co-city" className="field" value={addr.city} onChange={set("city")}>
                {PLACES.map((p) => (
                  <option key={p.city}>{p.city}</option>
                ))}
              </select>
            </div>
            <Field id="co-zip" label="Postcode" value={addr.zip} onChange={set("zip")} autoComplete="postal-code" />
          </div>
        </section>

        <section className="card mt-3 p-5">
          <h2 className="font-semibold">Payment</h2>
          {"error" in priced ? (
            <p className="mt-3 text-sm text-bad">{priced.error}</p>
          ) : process.env.NEXT_PUBLIC_ORBIT_STATIC === "1" ? (
            <Notice>Buying works in the Orbit app once it's online. This preview can't take payments.</Notice>
          ) : !env.paymentsEnabled ? (
            <Notice>Payments aren't switched on yet. The owner needs to add the Stripe keys (see DEPLOY.md).</Notice>
          ) : (
            <div className="mt-4">
              <StripePay amount={priced.authorized} createOrder={createOrder} onPaid={(o) => router.push(`/order/${o.id}`)} />
            </div>
          )}
        </section>
      </div>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="card mt-2 p-5 lg:mt-14">
          <div className="flex gap-3">
            <ProductArt product={product} small className="h-16 w-16 shrink-0" />
            <div className="min-w-0">
              <div className="truncate font-semibold">
                {product.brand} {product.title}
              </div>
              <div className="text-sm text-muted">
                from {store.name} · <span className={safety.level === "safe" ? "text-ok" : "text-warn"}>trust {safety.score}</span>
              </div>
            </div>
          </div>

          {"error" in priced ? null : (
            <>
              <div className="mt-4 flex items-center gap-1.5 text-sm">
                {priced.delivery.mode === "air" ? <Plane size={14} /> : <Truck size={14} />}
                {priced.delivery.label} · arrives about {arrivalWindow(priced.delivery.minDays + 1, priced.delivery.maxDays + 1)}
              </div>
              <div className="mt-4 space-y-1.5 text-[15px]">
                <Row label="Item" value={money(priced.item.price)} />
                <Row label="Delivery" value={money(priced.delivery.price)} />
                <Row label="Orbit service" value={money(priced.fee)} />
                <div className="my-2 border-t border-line" />
                <Row label={<b className="text-ink">Reserved now</b>} value={<b className="text-lg tabular-nums">{money(priced.authorized)}</b>} />
              </div>
              {coupon && (
                <div className="mt-3 flex gap-2 rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">
                  <BadgePercent size={16} className="mt-0.5 shrink-0" />
                  <span>
                    We&apos;ll try coupon <b className="font-mono">{coupon.code}</b>. If it works, you pay less.
                  </span>
                </div>
              )}
              <div className="mt-3 flex gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
                <Info size={16} className="mt-0.5 shrink-0" />
                <span>Your card is only charged once we&apos;ve placed the order at the shop. If we can&apos;t, the reservation is released and you pay nothing.</span>
              </div>
            </>
          )}
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck size={13} /> Payments by Stripe · card details never touch Orbit
          </p>
        </div>
      </aside>
    </div>
  );
}

function Field({ id, label, ...rest }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      <input id={id} className="field" {...rest} />
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">{children}</p>;
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
