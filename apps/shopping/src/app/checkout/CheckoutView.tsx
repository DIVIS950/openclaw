"use client";

import { Check, CreditCard, Lock, MapPin, Pencil, Plane, ShieldCheck, Truck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useUser } from "@/components/Providers";
import { ProductArt } from "@/components/ui";
import { cardBrand, expiryValid, formatCardNumber, formatExpiry, luhnValid } from "@/lib/card";
import { getOffer, getProduct, getStore } from "@/lib/data";
import { quoteDelivery } from "@/lib/delivery";
import { arrivalWindow, cn, money } from "@/lib/format";
import { findPlace, PLACES } from "@/lib/geo";
import { makeParcel } from "@/lib/parcels";
import { assessStore } from "@/lib/safety";
import { setAppState, useAppState, type Address } from "@/lib/store";

type Stage = "form" | "paying" | "done";

export function CheckoutView() {
  const params = useSearchParams();
  const router = useRouter();
  const offer = getOffer(params.get("offer") ?? "");
  const user = useUser();
  const { address, card } = useAppState();

  const [addr, setAddr] = useState<Address>(address);
  const [editAddr, setEditAddr] = useState(false);
  const [cardNum, setCardNum] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [useSaved, setUseSaved] = useState(Boolean(card));
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState("");

  // Prefill from the stored profile / Google account once it is available.
  useEffect(() => {
    setAddr((a) => ({ ...address, name: address.name || a.name || user?.name || "" }));
    setEditAddr(!address.line1);
    setUseSaved(Boolean(card));
  }, [address, card, user?.name]);

  if (!offer) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted">That offer is no longer available.</p>
        <Link href="/" className="btn btn-primary mt-4 px-5 py-2">
          Back to shopping
        </Link>
      </div>
    );
  }

  const product = getProduct(offer.productId)!;
  const store = getStore(offer.storeId)!;
  const safety = assessStore(store, offer.price, product.typicalPrice);
  const to = findPlace(addr.city) ?? findPlace("Prague")!;
  const quotes = quoteDelivery(store.warehouse, to);
  const quote = quotes.find((q) => q.speed === params.get("speed")) ?? quotes[0];
  const total = offer.price + quote.price;

  async function pay() {
    setError("");
    if (!addr.name.trim() || !addr.line1.trim() || !addr.zip.trim()) {
      setEditAddr(true);
      return setError("Please complete your delivery address.");
    }
    if (!useSaved) {
      if (!luhnValid(cardNum)) return setError("That card number doesn't look right.");
      if (!expiryValid(exp)) return setError("Check the expiry date (MM/YY).");
      if (!/^\d{3,4}$/.test(cvc)) return setError("Enter the 3–4 digit security code.");
    }
    if (safety.level === "danger") return setError("Orbit blocks payments to shops that look like scams.");

    setStage("paying");
    // Demo: simulate a tokenised payment. Live mode would confirm a Stripe PaymentIntent here.
    await new Promise((r) => setTimeout(r, 1800));

    const parcel = makeParcel({ title: `${product.brand} ${product.title}`, store: store.name, carrier: quote.carrier, from: store.warehouse, to, mode: quote.mode, maxDays: quote.maxDays });
    setAppState((s) => ({
      address: addr,
      // Only brand + last 4 digits are ever stored; the full number and CVC are discarded.
      card: useSaved ? s.card : { brand: cardBrand(cardNum), last4: cardNum.replace(/\D/g, "").slice(-4), exp, holder: addr.name },
      orders: [parcel, ...s.orders],
    }));
    setStage("done");
    setTimeout(() => router.push(`/track/${parcel.id}`), 1400);
  }

  return (
    <div className="mx-auto max-w-xl pb-10">
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">Checkout</h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
        <Lock size={13} /> Pay inside Orbit — no redirects, details already filled in.
      </p>

      <div className="card mt-5 flex gap-3 p-3">
        <ProductArt product={product} small className="h-20 w-20 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">
            {product.brand} {product.title}
          </div>
          <div className="text-sm text-muted">
            Sold by {store.name} · <span className={safety.level === "safe" ? "text-ok" : "text-warn"}>trust {safety.score}/100</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-sm">
            {quote.mode === "air" ? <Plane size={14} /> : <Truck size={14} />}
            {quote.label} · arrives {arrivalWindow(quote.minDays, quote.maxDays)}
          </div>
        </div>
      </div>

      <section className="card mt-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <MapPin size={17} className="text-accent" /> Deliver to
          </h2>
          {!editAddr && (
            <button onClick={() => setEditAddr(true)} className="flex items-center gap-1 text-sm text-accent-ink">
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>
        {editAddr ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input className="field col-span-2" placeholder="Full name" autoComplete="name" value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} />
            <input className="field col-span-2" placeholder="Street and number" autoComplete="address-line1" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} />
            <select className="field" value={to.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} aria-label="City">
              {PLACES.map((p) => (
                <option key={p.city}>{p.city}</option>
              ))}
            </select>
            <input className="field" placeholder="Postcode" autoComplete="postal-code" value={addr.zip} onChange={(e) => setAddr({ ...addr, zip: e.target.value })} />
            <input className="field col-span-2" placeholder="Phone (for the courier)" autoComplete="tel" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} />
          </div>
        ) : (
          <div className="mt-2 text-[15px] leading-snug">
            <div className="font-medium">{addr.name}</div>
            <div className="text-muted">
              {addr.line1}, {addr.zip} {to.city}
            </div>
          </div>
        )}
      </section>

      <section className="card mt-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <CreditCard size={17} className="text-accent" /> Payment
        </h2>
        {card && (
          <button onClick={() => setUseSaved(true)} className={cn("mt-3 flex w-full items-center gap-3 rounded-2xl border p-3 text-left", useSaved ? "border-accent bg-accent-soft/40" : "border-line")}>
            <span className="grid h-8 w-12 place-items-center rounded-md bg-ink text-[10px] font-bold text-bg">{card.brand.toUpperCase()}</span>
            <span className="flex-1">
              •••• {card.last4} <span className="text-sm text-muted">· exp {card.exp}</span>
            </span>
            {useSaved && <Check size={18} className="text-accent" />}
          </button>
        )}
        {card && !useSaved ? null : card ? (
          <button onClick={() => setUseSaved(false)} className="mt-2 text-sm text-accent-ink">
            Use a different card
          </button>
        ) : null}
        {!useSaved && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input className="field col-span-2 font-mono tracking-wider" inputMode="numeric" autoComplete="cc-number" placeholder="1234 1234 1234 1234" value={cardNum} onChange={(e) => setCardNum(formatCardNumber(e.target.value))} />
            <input className="field font-mono" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" value={exp} onChange={(e) => setExp(formatExpiry(e.target.value))} />
            <input className="field font-mono" inputMode="numeric" autoComplete="cc-csc" placeholder="CVC" maxLength={4} value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, ""))} />
            <p className="col-span-2 text-xs text-muted">Demo: use 4242 4242 4242 4242. Only the last 4 digits are saved.</p>
          </div>
        )}
      </section>

      <section className="card mt-3 space-y-1.5 p-4 text-[15px]">
        <Row label="Item" value={money(offer.price)} />
        <Row label={`Delivery · ${quote.label}`} value={money(quote.price)} />
        <div className="my-2 border-t border-line" />
        <Row label={<b>Total</b>} value={<b className="text-lg">{money(total)}</b>} />
      </section>

      {error && <p className="mt-3 rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button onClick={pay} disabled={stage !== "form"} className="btn btn-accent mt-4 h-14 w-full text-base shadow-[0_12px_30px_-10px_var(--accent)]">
        <Lock size={17} /> Pay {money(total)}
      </button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted">
        <ShieldCheck size={13} /> Encrypted · buyer protection · scam-checked shop
      </p>
      <p className="mt-1 text-center text-xs text-muted">Demo payment: no money is charged yet.</p>

      <AnimatePresence>
        {stage !== "form" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 grid place-items-center bg-bg/90 backdrop-blur-md">
            <div className="text-center">
              <motion.div
                className={cn("mx-auto grid h-24 w-24 place-items-center rounded-full", stage === "done" ? "bg-ok text-white" : "border-4 border-line border-t-accent")}
                animate={stage === "paying" ? { rotate: 360 } : { scale: [0.6, 1.1, 1] }}
                transition={stage === "paying" ? { repeat: Infinity, duration: 0.9, ease: "linear" } : { duration: 0.5 }}
              >
                {stage === "done" && <Check size={44} strokeWidth={3} />}
              </motion.div>
              <p className="mt-5 font-serif text-2xl font-semibold">{stage === "paying" ? "Securing payment…" : "Order placed!"}</p>
              <p className="mt-1 text-muted">{stage === "paying" ? "Talking to your bank" : "Opening live tracking"}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
