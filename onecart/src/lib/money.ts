import type { Money } from './types';

export function formatMoney({ cents, currency }: Money): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function sumLines(lines: { price: Money; quantity: number }[]): Money {
  const currency = lines[0]?.price.currency ?? 'USD';
  return { cents: lines.reduce((acc, l) => acc + l.price.cents * l.quantity, 0), currency };
}
