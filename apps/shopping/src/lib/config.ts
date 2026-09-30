/** Orbit's service fee in percent; falls back to 3 when the setting is missing or not a number. */
export function feePercent() {
  const n = Number(process.env.ORBIT_FEE_PERCENT ?? 3);
  return Number.isFinite(n) && n >= 0 && n <= 50 ? n : 3;
}
