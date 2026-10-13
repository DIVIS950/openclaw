import { describe, expect, it } from 'vitest';

import { parseShippingEmail } from './email-parser';

describe('parseShippingEmail', () => {
  it('reads store, order and UPS number', () => {
    const email = `From: "Allbirds" <orders@allbirds.com>
Subject: Your order #A12345 has shipped!

Good news, your order from Allbirds has shipped.
Tracking number: 1Z999AA10123456784 Carrier: UPS`;
    expect(parseShippingEmail(email)).toEqual({
      storeName: 'Allbirds',
      orderNumber: 'A12345',
      shipments: [{ trackingNumber: '1Z999AA10123456784', carrier: 'UPS' }],
    });
  });

  it('joins spaced USPS numbers', () => {
    const r = parseShippingEmail('Tracking #: 9400 1000 0000 0000 0000 00 via USPS');
    expect(r.shipments).toEqual([{ trackingNumber: '9400100000000000000000', carrier: 'USPS' }]);
  });

  it('does not report the order number as a tracking number', () => {
    const r = parseShippingEmail('Order number: 1234567890 is on its way. Tracking: 123456789012');
    expect(r.orderNumber).toBe('1234567890');
    expect(r.shipments).toEqual([{ trackingNumber: '123456789012', carrier: 'FedEx' }]);
  });

  it('returns no shipments when nothing matches', () => {
    expect(parseShippingEmail('Thanks for subscribing!').shipments).toEqual([]);
  });
});
