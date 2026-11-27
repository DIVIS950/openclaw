/** Colours and colour maths. Plain TypeScript (no React Native) so analysis code can use it anywhere. */
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

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
export function mix(a: string, b: string, t: number) {
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

