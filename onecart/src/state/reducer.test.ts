import { describe, expect, it } from 'vitest';

import type { Product, Shipment } from '@/lib/types';
import { initialState, reducer } from './reducer';

const product = (id: string, storeId: string, cents = 1000): Product => ({
  id,
  storeId,
  title: id,
  description: '',
  price: { cents, currency: 'USD' },
});

const shipment = (id: string, trackingNumber: string): Shipment => ({
  id,
  source: 'email',
  storeName: 'X',
  title: 'X',
  carrier: 'UPS',
  trackingNumber,
  createdAt: '2026-01-01T00:00:00Z',
});

describe('reducer', () => {
  it('adds and increments cart lines', () => {
    let s = reducer(initialState, { type: 'addToCart', product: product('a', 's1') });
    s = reducer(s, { type: 'addToCart', product: product('a', 's1') });
    expect(s.cart).toHaveLength(1);
    expect(s.cart[0].quantity).toBe(2);
  });

  it('removes a line at quantity 0', () => {
    const s = reducer(initialState, { type: 'addToCart', product: product('a', 's1') });
    expect(reducer(s, { type: 'setQuantity', productId: 'a', quantity: 0 }).cart).toEqual([]);
  });

  it('placing an order only clears that store from the cart and links its shipment', () => {
    let s = reducer(initialState, { type: 'addToCart', product: product('a', 's1', 500) });
    s = reducer(s, { type: 'addToCart', product: product('b', 's2') });
    s = reducer(s, {
      type: 'orderPlaced',
      order: { id: 'o1', storeId: 's1', storeName: 'S1', number: 'N1', lines: [s.cart[0]], placedAt: 'now' },
      shipment: shipment('sh1', '1Z999AA10123456784'),
    });
    expect(s.cart.map((l) => l.productId)).toEqual(['b']);
    expect(s.orders[0]).toMatchObject({ shipmentId: 'sh1', total: { cents: 500, currency: 'USD' } });
    expect(s.shipments).toHaveLength(1);
  });

  it('dedupes imported shipments by tracking number', () => {
    let s = reducer(initialState, { type: 'shipmentsImported', shipments: [shipment('1', 'T1')], emailId: 'm1' });
    s = reducer(s, { type: 'shipmentsImported', shipments: [shipment('2', 'T1'), shipment('3', 'T2')] });
    expect(s.shipments.map((x) => x.trackingNumber)).toEqual(['T2', 'T1']);
    expect(s.importedEmailIds).toEqual(['m1']);
  });
});
