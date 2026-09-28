import "server-only";
import Stripe from "stripe";

export const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

let client: Stripe | null = null;
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
  // ORBIT_TEST=1 + STRIPE_API_BASE points the SDK at a local fake Stripe (tests only).
  const base = process.env.ORBIT_TEST === "1" ? process.env.STRIPE_API_BASE : undefined;
  const u = base ? new URL(base) : null;
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY, u ? { host: u.hostname, port: Number(u.port), protocol: u.protocol === "http:" ? "http" : "https" } : undefined);
  return client;
}

export const toCents = (eur: number) => Math.round(eur * 100);
export const fromCents = (cents: number) => cents / 100;
