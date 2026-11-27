import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { C, ramp, svgFont } from './theme';

interface Props {
  size: number;
  label: string;
  /** Display value (already in the user's units), NaN = no sensor. */
  value: number;
  min: number;
  max: number;
  limit: number;
  unit: string;
  enabled?: boolean;
}

const SWEEP = 240; // degrees of arc
const START = 150; // degrees, measured clockwise from 3 o'clock

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

/** 240° arc gauge with a red limit tick. Turns amber near the limit and red above it. */
export function Gauge({ size, label, value, min, max, limit, unit, enabled = true }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 9;
  const ok = enabled && Number.isFinite(value);
  const frac = ok ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const limitFrac = Math.max(0, Math.min(1, (limit - min) / (max - min)));
  const span = max - min;
  const color = !ok ? C.faint : value >= limit ? C.red : value > limit - span * 0.08 ? ramp([C.green, C.amber], (value - (limit - span * 0.08)) / (span * 0.08)) : C.green;
  const [lx0, ly0] = polar(cx, cy, r - 9, START + SWEEP * limitFrac);
  const [lx1, ly1] = polar(cx, cy, r + 7, START + SWEEP * limitFrac);
  return (
    <Svg width={size} height={size * 0.86}>
      <Path d={arc(cx, cy, r, START, START + SWEEP)} stroke={C.panel2} strokeWidth={9} strokeLinecap="round" fill="none" />
      {ok && frac > 0.005 && <Path d={arc(cx, cy, r, START, START + SWEEP * frac)} stroke={color} strokeWidth={9} strokeLinecap="round" fill="none" />}
      <Line x1={lx0} y1={ly0} x2={lx1} y2={ly1} stroke={C.red} strokeWidth={3} strokeLinecap="round" />
      <SvgText fontFamily={svgFont} x={cx} y={cy + 4} fill={ok ? (value >= limit ? C.red : C.text) : C.faint} fontSize={size * 0.24} fontWeight="800" textAnchor="middle">
        {ok ? String(Math.round(value)) : enabled ? '—' : 'OFF'}
      </SvgText>
      <SvgText fontFamily={svgFont} x={cx} y={cy + size * 0.17} fill={C.dim} fontSize={size * 0.085} fontWeight="700" textAnchor="middle">
        {unit}
      </SvgText>
      <SvgText fontFamily={svgFont} x={cx} y={size * 0.82} fill={C.dim} fontSize={size * 0.09} fontWeight="800" letterSpacing={1.5} textAnchor="middle">
        {label}
      </SvgText>
    </Svg>
  );
}
