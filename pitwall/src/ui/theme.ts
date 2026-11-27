import { Platform, type TextStyle } from 'react-native';

export const C = {
  bg: '#07080A',
  panel: '#0F1114',
  panel2: '#16191D',
  line: '#23272D',
  text: '#F4F6F8',
  dim: '#8A919B',
  faint: '#4B515A',
  /** The one brand accent. */
  accent: '#00E0C6',
  // F1-style timing colours.
  green: '#22D66B',
  red: '#FF3B3B',
  purple: '#B45CFF',
  yellow: '#FFD23F',
  // Temperature scale.
  cold: '#3D8BFF',
  amber: '#FF9F1C',
};

/** Monospaced figures so numbers do not jump around while they change. */
export const num: TextStyle = { fontVariant: ['tabular-nums'], color: C.text, fontWeight: '700' };

export const label: TextStyle = { color: C.dim, fontSize: 11, fontWeight: '700', letterSpacing: 1.6 };

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
function mix(a: string, b: string, t: number) {
  const x = hex(a);
  const y = hex(b);
  const k = Math.max(0, Math.min(1, t));
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * k) as RGB);
}

/** Colour along a list of stops, `t` from 0 to 1. */
export function ramp(stops: string[], t: number) {
  const k = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(k));
  return mix(stops[i], stops[i + 1], k - i);
}

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
