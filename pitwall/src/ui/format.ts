import type { Units } from '../store/settings';

const MINUS = '−';

/** 67845 → "1:07.845" (digits = decimals). */
export function fmtLap(ms: number | null | undefined, digits: 1 | 2 | 3 = 3) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  // Truncate (like a stopwatch), never round up to the next second.
  const s = Math.floor((total - m * 60) * 10 ** digits) / 10 ** digits;
  return `${m}:${s.toFixed(digits).padStart(digits + 3, '0')}`;
}

/** Sector / short time: 20845 → "20.84". */
export function fmtSec(ms: number | null | undefined, digits = 2) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  return (Math.floor((ms / 1000) * 10 ** digits) / 10 ** digits).toFixed(digits);
}

/** Delta in ms → "−0.42" / "+1.07". */
export function fmtDelta(ms: number | null | undefined, digits = 2) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '±0.00';
  const s = Math.abs(ms / 1000).toFixed(digits);
  if (Number(s) === 0) return '±' + s;
  return (ms < 0 ? MINUS : '+') + s;
}

export function speed(kmh: number, units: Units) {
  return units === 'imperial' ? kmh * 0.621371 : kmh;
}
export const speedUnit = (units: Units) => (units === 'imperial' ? 'mph' : 'km/h');

export function temp(c: number, units: Units) {
  return units === 'imperial' ? c * 1.8 + 32 : c;
}
export const tempUnit = (units: Units) => (units === 'imperial' ? '°F' : '°C');

/** Whole-number temperature or a dash for a missing sensor. */
export function fmtTemp(c: number, units: Units) {
  return Number.isFinite(c) ? String(Math.round(temp(c, units))) : '—';
}

export function fmtDate(epochMs: number) {
  const d = new Date(epochMs);
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}
