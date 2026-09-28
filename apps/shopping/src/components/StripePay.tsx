"use client";

import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { money } from "@/lib/format";

let stripePromise: Promise<Stripe | null> | null = null;
// A blocked or offline Stripe.js resolves to null instead of crashing the page.
const getStripe = () => (stripePromise ??= loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").catch(() => null));

export type CreatedOrder = { id: string; token: string; clientSecret: string; authorized: number };

type Props = {
  amount: number;
  /** Checks the form and creates the order on the server; returns an error message or the order. */
  createOrder: () => Promise<CreatedOrder | string>;
  onPaid: (order: CreatedOrder) => void;
};

/**
 * Apple Pay / Google Pay (Express Checkout) plus card, via Stripe. The
 * PaymentIntent is created only after the customer confirms ("deferred
 * intent"), with manual capture so the money is just reserved.
 */
export function StripePay(props: Props) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void getStripe().then((s) => alive && setFailed(!s));
    return () => {
      alive = false;
    };
  }, []);
  if (failed) {
    return <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">The payment form couldn&apos;t load. Check your connection or turn off content blockers for this site, then reload.</p>;
  }
  return (
    <Elements
      stripe={getStripe()}
      options={{
        mode: "payment",
        amount: Math.round(props.amount * 100),
        currency: "eur",
        captureMethod: "manual",
        appearance: {
          theme: "stripe",
          variables: { colorPrimary: "#3150f0", colorText: "#14131c", borderRadius: "12px", fontFamily: "DM Sans, system-ui, sans-serif" },
        },
        fonts: [{ cssSrc: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap" }],
      }}
    >
      <PayForm {...props} />
    </Elements>
  );
}

function PayForm({ amount, createOrder, onPaid }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function pay(): Promise<string | null> {
    if (!stripe || !elements) return "Payments are still loading.";
    const { error: submitError } = await elements.submit();
    if (submitError) return submitError.message ?? "Check your payment details.";
    const created = await createOrder();
    if (typeof created === "string") return created;
    const { error: payError } = await stripe.confirmPayment({
      elements,
      clientSecret: created.clientSecret,
      confirmParams: { return_url: `${window.location.origin}/order/${created.id}` },
      redirect: "if_required",
    });
    if (payError) return payError.message ?? "The payment didn't go through.";
    onPaid(created);
    return null;
  }

  async function run() {
    setBusy(true);
    setError("");
    try {
      const msg = await pay();
      if (msg) setError(msg);
    } catch {
      setError("Something went wrong. You haven't been charged; try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ExpressCheckoutElement
        options={{ buttonType: { applePay: "buy", googlePay: "buy" }, buttonHeight: 52, paymentMethodOrder: ["apple_pay", "google_pay"] }}
        onConfirm={async (event) => {
          setBusy(true);
          setError("");
          try {
            const msg = await pay();
            if (msg) {
              event.paymentFailed({ reason: "fail" });
              setError(msg);
            }
          } finally {
            setBusy(false);
          }
        }}
      />
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> or pay by card <span className="h-px flex-1 bg-line" />
      </div>
      <PaymentElement options={{ layout: "tabs", wallets: { applePay: "never", googlePay: "never" } }} />
      {error && <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <button onClick={run} disabled={busy || !stripe} className="btn btn-primary h-13 w-full text-base">
        <Lock size={17} /> {busy ? "Reserving…" : `Reserve ${money(amount)}`}
      </button>
    </div>
  );
}
