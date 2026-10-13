import type { Carrier } from '../types';
import { detectCarrier, normalizeTrackingNumber } from './carrier';

export type ParsedShippingEmail = {
  storeName?: string;
  orderNumber?: string;
  shipments: { trackingNumber: string; carrier: Carrier }[];
};

const LABELLED_TRACKING = /tracking\s*(?:number|no\.?|#|id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9 -]{8,34}[A-Z0-9])/gi;
const TOKEN = /\b(1Z[0-9A-Z]{16}|[A-Z]{2}\d{9}US|JJD\d{16,20}|\d{10,22})\b/g;
const ORDER = /order\s*(?:#|number|no\.?)\s*:?\s*#?([A-Z0-9-]{3,20})/i;
const STORE_PATTERNS = [
  /^from:\s*"?([^"<\n]+?)"?\s*</im,
  /your\s+(?:order|package)\s+from\s+([A-Z][\w&' .-]{1,40}?)(?:\s+(?:has|is|was)\b|[.!,\n])/i,
];

/**
 * Pulls tracking numbers, order number and store name out of a shipping
 * confirmation email (plain text, headers optional).
 */
export function parseShippingEmail(text: string): ParsedShippingEmail {
  const found = new Map<string, Carrier>();
  const add = (raw: string) => {
    const n = normalizeTrackingNumber(raw);
    const carrier = detectCarrier(n);
    if (carrier !== 'Unknown' && !found.has(n)) found.set(n, carrier);
  };

  // Labelled numbers may contain spaces ("9400 1000 ...") and run into the next
  // word, so try the longest run of words that still forms a valid number.
  for (const m of text.matchAll(LABELLED_TRACKING)) {
    const words = m[1].split(/\s+/);
    for (let k = words.length; k > 0; k--) {
      const candidate = words.slice(0, k).join('');
      if (detectCarrier(candidate) !== 'Unknown') {
        add(candidate);
        break;
      }
    }
  }
  for (const m of text.toUpperCase().matchAll(TOKEN)) add(m[1]);

  const orderNumber = text.match(ORDER)?.[1];
  // A bare order number can look like a tracking number; never report it as one.
  if (orderNumber) found.delete(normalizeTrackingNumber(orderNumber));

  let storeName: string | undefined;
  for (const re of STORE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      storeName = m[1].trim();
      break;
    }
  }

  return {
    storeName,
    orderNumber,
    shipments: [...found].map(([trackingNumber, carrier]) => ({ trackingNumber, carrier })),
  };
}
