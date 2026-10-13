import type { CartLine } from './types';

export function groupByStore(lines: CartLine[]): [string, CartLine[]][] {
  const groups = new Map<string, CartLine[]>();
  for (const l of lines) groups.set(l.storeId, [...(groups.get(l.storeId) ?? []), l]);
  return [...groups];
}
