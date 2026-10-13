export type Money = { cents: number; currency: string };

export type Store = {
  id: string;
  name: string;
  domain: string;
  platform: 'demo' | 'shopify';
  accent: string;
};

export type Product = {
  id: string;
  storeId: string;
  title: string;
  description: string;
  price: Money;
  image?: string;
  /** Shopify variant GID, used when building a real cart. */
  variantId?: string;
};

export type CartLine = {
  productId: string;
  storeId: string;
  variantId?: string;
  title: string;
  price: Money;
  quantity: number;
  image?: string;
};

export type Address = {
  name: string;
  email: string;
  line1: string;
  city: string;
  postalCode: string;
  country: string;
};

export type Carrier = 'UPS' | 'USPS' | 'FedEx' | 'DHL' | 'Unknown';

export type ShipmentStatus =
  | 'label_created'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'unknown';

export type TrackingEvent = {
  at: string;
  status: ShipmentStatus;
  message: string;
  location?: string;
};

export type Shipment = {
  id: string;
  source: 'order' | 'email';
  storeName: string;
  title: string;
  carrier: Carrier;
  trackingNumber: string;
  createdAt: string;
  orderId?: string;
  orderNumber?: string;
};

export type Order = {
  id: string;
  storeId: string;
  storeName: string;
  number: string;
  lines: CartLine[];
  total: Money;
  placedAt: string;
  shipmentId?: string;
};
