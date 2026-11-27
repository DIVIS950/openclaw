import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { TelemetryFrame } from '../telemetry/types';
import { fmtTemp } from './format';
import type { Units } from '../store/settings';
import { BRAKE_BAND, C, TYRE_BAND, tempColor, svgFont } from './theme';

interface Props {
  width: number;
  frame: TelemetryFrame | null;
  units: Units;
  tyreLimit: number;
  brakeLimit: number;
  tyresOn: boolean;
  brakesOn: boolean;
}

// Drawn in a 320 × 340 box and scaled to `width`.
const VB_W = 320;
const VB_H = 340;

/** Top view of the car: tyres and front discs coloured cold → optimal → hot. */
export function CarDiagram({ width, frame, units, tyreLimit, brakeLimit, tyresOn, brakesOn }: Props) {
  const tyre = (k: 'fl' | 'fr' | 'rl' | 'rr') => (frame && tyresOn ? frame.tyre[k] : NaN);
  const disc = (k: 'fl' | 'fr') => (frame && brakesOn ? frame.brake[k] : NaN);
  const tb = TYRE_BAND(tyreLimit);
  const bb = BRAKE_BAND(brakeLimit);

  const tyreEl = (k: 'fl' | 'fr' | 'rl' | 'rr', x: number, y: number) => {
    const v = tyre(k);
    const col = tempColor(v, tb);
    const left = k[1] === 'l';
    const tx = left ? x - 14 : x + 42;
    return (
      <G key={k}>
        <Rect x={x} y={y} width={28} height={60} rx={8} fill={col} fillOpacity={Number.isFinite(v) ? 0.9 : 0.25} />
        <Rect x={x + 4} y={y + 6} width={20} height={48} rx={5} fill="none" stroke={C.bg} strokeOpacity={0.35} strokeWidth={1.5} />
        <SvgText fontFamily={svgFont} x={tx} y={y + 30} fill={Number.isFinite(v) ? C.text : C.faint} fontSize={32} fontWeight="800" textAnchor={left ? 'end' : 'start'}>
          {tyresOn ? fmtTemp(v, units) : 'OFF'}
        </SvgText>
        <SvgText fontFamily={svgFont} x={tx} y={y + 50} fill={C.dim} fontSize={12} fontWeight="700" letterSpacing={1.5} textAnchor={left ? 'end' : 'start'}>
          {k.toUpperCase()}
        </SvgText>
      </G>
    );
  };

  const discEl = (k: 'fl' | 'fr', cx: number) => {
    const v = disc(k);
    return (
      <G key={`disc-${k}`}>
        <Circle cx={cx} cy={98} r={17} fill={tempColor(v, bb)} fillOpacity={Number.isFinite(v) ? 0.95 : 0.25} />
        <Circle cx={cx} cy={98} r={6} fill={C.bg} />
      </G>
    );
  };

  return (
    <Svg width={width} height={(width * VB_H) / VB_W} viewBox={`0 0 ${VB_W} ${VB_H}`}>
      {/* Body: a compact hatchback, nose up */}
      <Path
        d="M120 26 Q160 12 200 26 Q222 34 224 70 L226 290 Q226 322 196 326 L124 326 Q94 322 94 290 L96 70 Q98 34 120 26 Z"
        fill={C.panel2}
        stroke={C.line}
        strokeWidth={2}
      />
      {/* Windscreen, roof, rear window */}
      <Path d="M112 128 Q160 112 208 128 L202 160 Q160 150 118 160 Z" fill={C.bg} fillOpacity={0.8} />
      <Rect x={118} y={166} width={84} height={96} rx={10} fill={C.panel} />
      <Path d="M120 270 Q160 278 200 270 L204 296 Q160 304 116 296 Z" fill={C.bg} fillOpacity={0.8} />
      {tyreEl('fl', 76, 68)}
      {tyreEl('fr', 216, 68)}
      {tyreEl('rl', 76, 244)}
      {tyreEl('rr', 216, 244)}
      {discEl('fl', 128)}
      {discEl('fr', 192)}
      <SvgText fontFamily={svgFont} x={160} y={208} fill={C.dim} fontSize={11} fontWeight="800" letterSpacing={1.5} textAnchor="middle">
        BRAKES
      </SvgText>
      <SvgText fontFamily={svgFont} x={160} y={232} fill={brakesOn ? C.text : C.faint} fontSize={17} fontWeight="800" textAnchor="middle">
        {brakesOn ? `${fmtTemp(disc('fl'), units)} · ${fmtTemp(disc('fr'), units)}` : 'OFF'}
      </SvgText>
    </Svg>
  );
}
