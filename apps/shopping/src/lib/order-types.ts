// Shared by the server (API routes) and the browser (order pages).

export type OrderStatus =
  | "pending_payment" // created, waiting for the customer to approve the payment
  | "held" // money reserved on the customer's card, not charged yet
  | "ordered" // Orbit placed the order at the shop and charged the customer
  | "shipped" // the shop shipped it; tracking number known
  | "delivered"
  | "cancelled"; // hold released, nothing charged

export type OrderEvent = { at: number; status: OrderStatus; note?: string };

export type OrderItem = {
  productId: string;
  offerId: string;
  title: string;
  brand: string;
  store: string;
  domain: string;
  url?: string;
  price: number;
  /** Warehouse city used for the map. */
  fromCity: string;
};

export type OrderDelivery = { label: string; price: number; carrier: string; mode: "air" | "road"; minDays: number; maxDays: number };

export type OrderCoupon = { code: string; description: string };

export type Order = {
  id: string;
  /** Secret the customer's device keeps to view the order (no account needed). */
  token: string;
  createdAt: number;
  status: OrderStatus;
  events: OrderEvent[];
  customer: { name: string; email: string; phone: string };
  address: { line1: string; city: string; zip: string; country: string };
  item: OrderItem;
  delivery: OrderDelivery;
  coupon?: OrderCoupon;
  /** All amounts in EUR. `authorized` is what is held on the card; `charged` what was finally taken. */
  fee: number;
  authorized: number;
  charged?: number;
  paymentIntentId?: string;
  shopOrderNumber?: string;
  carrier?: string;
  trackingNumber?: string;
};

/** What the customer's browser may see (no payment ids). */
export type PublicOrder = Omit<Order, "token" | "paymentIntentId">;

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Waiting for payment",
  held: "Payment reserved",
  ordered: "Ordered from the shop",
  shipped: "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Orbit's service fee: a percentage with a small minimum, rounded to cents. */
export function serviceFee(subtotal: number, percent: number) {
  return Math.max(1, Math.round(subtotal * percent) / 100);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Public tracking page for the common carriers, if we know one. */
export function carrierTrackingUrl(carrier: string, number: string): string | undefined {
  const c = carrier.toLowerCase();
  const n = encodeURIComponent(number);
  if (c.includes("dhl")) return `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${n}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${n}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
  if (c.includes("dpd")) return `https://tracking.dpd.de/status/en_US/parcel/${n}`;
  if (c.includes("ppl")) return `https://www.ppl.cz/vyhledat-zasilku?shipmentId=${n}`;
  if (c.includes("packeta") || c.includes("zásilkovna") || c.includes("zasilkovna")) return `https://tracking.packeta.com/en/?id=${n}`;
  if (c.includes("gls")) return `https://gls-group.com/CZ/en/parcel-tracking?match=${n}`;
  if (c.includes("česká pošta") || c.includes("czech post")) return `https://www.postaonline.cz/en/trackandtrace/-/zasilka/cislo?parcelNumbers=${n}`;
  return undefined;
}
