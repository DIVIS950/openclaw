// Older iPhone Safari (iOS 15 and earlier) lacks these array helpers; without them
// the Today screen (timetable sorting) crashes before it can render.
type Cmp = (a: unknown, b: unknown) => number;
type Pred = (v: unknown, i: number) => boolean;
interface ArrayExtras {
  toSorted?: (cmp?: Cmp) => unknown[];
  toReversed?: () => unknown[];
  findLast?: (fn: Pred) => unknown;
  at?: (i: number) => unknown;
}
const proto = Array.prototype as unknown as ArrayExtras;
if (typeof proto.toSorted !== "function") {
  proto.toSorted = function toSorted(this: unknown[], cmp?: Cmp) {
    // oxlint-disable-next-line unicorn/no-array-sort -- this is the toSorted fallback itself
    return [...this].sort(cmp);
  };
}
if (typeof proto.toReversed !== "function") {
  proto.toReversed = function toReversed(this: unknown[]) {
    // oxlint-disable-next-line unicorn/no-array-reverse -- this is the toReversed fallback itself
    return [...this].reverse();
  };
}
if (typeof proto.findLast !== "function") {
  proto.findLast = function findLast(this: unknown[], fn: Pred) {
    for (let i = this.length - 1; i >= 0; i--) {
      if (fn(this[i], i)) {
        return this[i];
      }
    }
    return undefined;
  };
}
if (typeof proto.at !== "function") {
  proto.at = function at(this: unknown[], i: number) {
    return this[i < 0 ? this.length + i : i];
  };
}
const obj = Object as unknown as { hasOwn?: (o: object, k: PropertyKey) => boolean };
if (typeof obj.hasOwn !== "function") {
  obj.hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
}
