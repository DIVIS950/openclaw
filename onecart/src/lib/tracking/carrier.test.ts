import { describe, expect, it } from 'vitest';

import { detectCarrier, fakeUpsNumber } from './carrier';

describe('detectCarrier', () => {
  it.each([
    ['1Z999AA10123456784', 'UPS'],
    ['1z 999 aa1 0123 4567 84', 'UPS'],
    ['9400100000000000000000', 'USPS'],
    ['EC123456789US', 'USPS'],
    ['123456789012', 'FedEx'],
    ['123456789012345', 'FedEx'],
    ['1234567890', 'DHL'],
    ['JJD0123456789012345', 'DHL'],
    ['hello', 'Unknown'],
  ])('%s -> %s', (input, carrier) => {
    expect(detectCarrier(input)).toBe(carrier);
  });

  it('demo UPS numbers are detected as UPS', () => {
    expect(detectCarrier(fakeUpsNumber('order-1'))).toBe('UPS');
  });
});
