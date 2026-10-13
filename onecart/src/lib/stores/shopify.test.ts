import { describe, expect, it } from 'vitest';

import { shopifyConnectorsFromEnv } from './shopify';

describe('shopifyConnectorsFromEnv', () => {
  it('parses domain|token pairs', () => {
    const list = shopifyConnectorsFromEnv('a.myshopify.com|tok1, b.myshopify.com|tok2');
    expect(list.map((c) => c.store.name)).toEqual(['a', 'b']);
  });

  it('skips broken entries', () => {
    expect(shopifyConnectorsFromEnv('nodomain')).toEqual([]);
    expect(shopifyConnectorsFromEnv(undefined)).toEqual([]);
  });
});
