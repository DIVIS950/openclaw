import { Platform, type TextStyle } from 'react-native';
import { C, mix, ramp } from './palette';

export { C, ramp };

/** Monospaced figures so numbers do not jump around while they change. */
export const num: TextStyle = { fontVariant: ['tabular-nums'], color: C.text, fontWeight: '700' };

export const label: TextStyle = { color: C.dim, fontSize: 11, fontWeight: '700', letterSpacing: 1.6 };

export interface TempBand {
  /** At or below: fully cold (blue). */
  cold: number;
  /** Optimal window (green). */
  optLo: number;
  optHi: number;
  /** At or above: red. Usually the warning limit. */
  hot: number;
}

export const TYRE_BAND = (limit: number): TempBand => ({ cold: 45, optLo: 75, optHi: 100, hot: limit });
export const BRAKE_BAND = (limit: number): TempBand => ({ cold: 150, optLo: 300, optHi: 650, hot: limit });

/** cold blue → optimal green → amber → hot red. NaN (no sensor) = grey. */
export function tempColor(v: number, b: TempBand) {
  if (!Number.isFinite(v)) return C.faint;
  if (v <= b.cold) return C.cold;
  if (v < b.optLo) return mix(C.cold, C.green, (v - b.cold) / (b.optLo - b.cold));
  if (v <= b.optHi) return C.green;
  if (v < b.hot) return ramp([C.green, C.amber, C.red], (v - b.optHi) / (b.hot - b.optHi) * 0.9);
  return C.red;
}

/** Racing line colour: slow (red) → fast (accent). */
export const SPEED_STOPS = [C.red, C.amber, C.yellow, '#7CF07C', C.accent];

/** SVG text does not inherit the app font; pick a clean sans-serif per platform. */
export const svgFont = Platform.select({ ios: 'Helvetica Neue', android: 'sans-serif', default: 'system-ui, -apple-system, Helvetica, Arial, sans-serif' });
