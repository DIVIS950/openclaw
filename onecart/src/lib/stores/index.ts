import type { StoreConnector } from './connector';
import { demoConnectors } from './demo';
import { shopifyConnectorsFromEnv } from './shopify';

export const connectors: StoreConnector[] = [...shopifyConnectorsFromEnv(), ...demoConnectors];

export function getConnector(storeId: string): StoreConnector | undefined {
  return connectors.find((c) => c.store.id === storeId);
}

export type { CheckoutResult, StoreConnector } from './connector';
