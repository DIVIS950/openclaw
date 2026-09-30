import { z } from "zod";
import { getStaticProduct, getStore, OFFERS } from "./data";
import { quoteDelivery } from "./delivery";
import { findPlace } from "./geo";
import { round2, serviceFee, type OrderDelivery, type OrderItem } from "./order-types";

const httpsUrl = z
  .string()
  .max(500)
  .refine((u) => {
    try {
      return new URL(u).protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an https link");

export const OrderInput = z.object({
  customer: z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().min(5).max(30),
  }),
  address: z.object({
    line1: z.string().trim().min(3).max(200),
    city: z.string().trim().max(80),
    zip: z.string().trim().min(3).max(12),
    country: z.string().trim().min(2).max(60),
  }),
  item: z.object({
    productId: z.string().max(120),
    offerId: z.string().max(200),
    title: z.string().trim().min(1).max(120),
    brand: z.string().trim().max(60),
    store: z.string().trim().min(1).max(60),
    domain: z.string().trim().min(3).max(100),
    url: httpsUrl.optional(),
    price: z.number().finite().min(0.5).max(20000),
    fromCity: z.string().max(80),
  }),
  speed: z.enum(["economy", "standard", "express", "sameday"]),
  coupon: z.object({ code: z.string().trim().min(2).max(40), description: z.string().trim().max(200) }).optional(),
});
export type OrderInput = z.infer<typeof OrderInput>;

/** "www.shop.cz/path" -> "shop.cz"; empty when it isn't a plausible hostname. */
export function normalizeDomain(raw: string) {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : "";
}

export type PricedOrder = { item: OrderItem; delivery: OrderDelivery; fee: number; authorized: number };

/**
 * Recomputes every amount on the server; the browser only suggests the item.
 * Built-in catalog prices can't be changed by the client. For search results
 * the quoted price is kept, and the order is reviewed by a person before any
 * money is taken, never more than the amount the customer approved.
 */
export function priceOrder(input: OrderInput, feePercent: number): PricedOrder | { error: string } {
  const from = findPlace(input.item.fromCity);
  const to = findPlace(input.address.city);
  if (!from) return { error: "Unknown shop location." };
  if (!to) return { error: "We don't deliver to that city yet." };

  let price = input.item.price;
  let item = { ...input.item };
  if (getStaticProduct(input.item.productId)) {
    // Catalog product: take the price AND the shop from the catalog, never from the browser.
    const offer = OFFERS.find((o) => o.id === input.item.offerId && o.productId === input.item.productId);
    const store = offer && getStore(offer.storeId);
    if (!offer || !store) return { error: "That offer is no longer available." };
    price = offer.price;
    item = { ...item, store: store.name, domain: store.domain, url: offer.url, fromCity: store.warehouse.city };
  } else {
    // Search result: the link the admin will open must be on the shop's own domain.
    const domain = normalizeDomain(input.item.domain);
    if (!domain) return { error: "Unknown shop." };
    const host = input.item.url ? new URL(input.item.url).hostname.toLowerCase() : undefined;
    if (host && host !== domain && !host.endsWith(`.${domain}`)) return { error: "The product link doesn't match the shop." };
    item = { ...item, domain };
  }

  const quote = quoteDelivery(from, to).find((q) => q.speed === input.speed);
  if (!quote) return { error: "That delivery option isn't available for this address." };

  const subtotal = round2(price + quote.price);
  const fee = serviceFee(subtotal, feePercent);
  return {
    item: { ...item, price: round2(price), fromCity: item.fromCity || from.city },
    delivery: { label: quote.label, price: quote.price, carrier: quote.carrier, mode: quote.mode, minDays: quote.minDays, maxDays: quote.maxDays },
    fee,
    authorized: round2(subtotal + fee),
  };
}
