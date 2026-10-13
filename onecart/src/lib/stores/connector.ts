import type { Address, CartLine, Product, Store } from '../types';

export type CheckoutResult =
  /** The store accepted the order directly (demo stores). */
  | { kind: 'placed'; orderNumber: string; trackingNumber: string }
  /** The store's own secure checkout must finish payment (real Shopify stores). */
  | { kind: 'hosted'; checkoutUrl: string };

/** One adapter per shop platform. Add Amazon, WooCommerce, etc. by implementing this. */
export interface StoreConnector {
  store: Store;
  search(query: string): Promise<Product[]>;
  checkout(lines: CartLine[], address: Address): Promise<CheckoutResult>;
}
