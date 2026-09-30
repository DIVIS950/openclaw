"use client";

import { Check, ShoppingBag, Truck } from "lucide-react";
import { motion } from "motion/react";

/** Shown once, right after a successful payment, above the order status. */
export function OrderPlaced({ title, store, onDismiss }: { title: string; store: string; onDismiss: () => void }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", damping: 22, stiffness: 240 }}
      className="card relative mt-5 overflow-hidden p-6 text-center"
      aria-live="polite"
    >
      <span className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-accent-soft" aria-hidden />
      <span className="pointer-events-none absolute -bottom-20 -right-12 h-44 w-44 rounded-full bg-ok-soft" aria-hidden />
      <motion.span
        initial={{ scale: 0.4 }}
        animate={{ scale: [0.4, 1.12, 1] }}
        transition={{ duration: 0.55, delay: 0.15 }}
        className="relative mx-auto grid h-16 w-16 place-items-center rounded-full bg-ok text-white shadow-[0_12px_30px_-10px_var(--ok)]"
      >
        <Check size={32} strokeWidth={3} />
      </motion.span>
      <h2 className="relative mt-4 font-serif text-2xl font-bold">Order placed</h2>
      <p className="relative mx-auto mt-1 max-w-sm text-muted">
        Your payment for <b className="text-ink">{title}</b> is reserved, not charged yet.
      </p>
      <ol className="relative mx-auto mt-5 grid max-w-md gap-2 text-left text-sm sm:grid-cols-3">
        <Step icon={<ShoppingBag size={16} />} n={1} text={`We buy it for you at ${store}, usually within 1 business day.`} />
        <Step icon={<Check size={16} />} n={2} text="Only then is your card charged; less if a coupon works." />
        <Step icon={<Truck size={16} />} n={3} text="Watch it travel to your door on this page." />
      </ol>
      <button onClick={onDismiss} className="btn btn-ghost relative mt-5 h-10 px-5 text-sm">
        Got it
      </button>
    </motion.section>
  );
}

function Step({ icon, n, text }: { icon: React.ReactNode; n: number; text: string }) {
  return (
    <li className="flex gap-2.5 rounded-xl bg-surface-2 p-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface text-accent-ink">{icon}</span>
      <span>
        <span className="sr-only">Step {n}: </span>
        {text}
      </span>
    </li>
  );
}
