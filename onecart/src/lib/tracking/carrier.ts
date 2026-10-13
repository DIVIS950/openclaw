import type { Carrier } from '../types';

// Ordered: more specific formats first, because plain digit runs overlap between carriers.
const PATTERNS: { carrier: Carrier; re: RegExp }[] = [
  { carrier: 'UPS', re: /^1Z[0-9A-Z]{16}$/ },
  { carrier: 'USPS', re: /^(91|92|93|94|95|82)\d{18,20}$/ },
  { carrier: 'USPS', re: /^[A-Z]{2}\d{9}US$/ },
  { carrier: 'DHL', re: /^JJD\d{16,20}$/ },
  { carrier: 'FedEx', re: /^(\d{12}|\d{15})$/ },
  { carrier: 'DHL', re: /^\d{10}$/ },
];

export function normalizeTrackingNumber(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export function detectCarrier(raw: string): Carrier {
  const value = normalizeTrackingNumber(raw);
  return PATTERNS.find((p) => p.re.test(value))?.carrier ?? 'Unknown';
}

export function carrierTrackingUrl(carrier: Carrier, trackingNumber: string): string | undefined {
  const n = encodeURIComponent(trackingNumber);
  switch (carrier) {
    case 'UPS':
      return `https://www.ups.com/track?tracknum=${n}`;
    case 'USPS':
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    case 'FedEx':
      return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case 'DHL':
      return `https://www.dhl.com/en/express/tracking.html?AWB=${n}`;
    default:
      return undefined;
  }
}

/** Builds a valid-looking UPS number for demo orders. */
export function fakeUpsNumber(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const digits = String(hash).padStart(10, '0').slice(0, 10);
  return `1Z999AA1${digits}`;
}
