import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from 'react-native-svg';
import type { StartFinishLine } from '../lap/LapTimer';
import { C, SPEED_STOPS, ramp, svgFont } from './theme';

export interface MapLine {
  lat: number[];
  lon: number[];
  /** If given, the line is coloured by speed. */
  v?: number[];
  /** Or: an explicit colour for every point (wins over `v`). */
  colors?: string[];
  color?: string;
  width?: number;
  opacity?: number;
}

export interface TrackMapProps {
  width: number;
  height: number;
  lines: MapLine[];
  trail?: { lat: number[]; lon: number[] };
  car?: { lat: number; lon: number } | null;
  startFinish?: StartFinishLine | null;
  /** Sector split points (S1/S2 ends). */
  splits?: { lat: number; lon: number }[];
  /** Small coloured dots, e.g. braking points. */
  markers?: { lat: number; lon: number; color: string }[];
}

type Project = (lat: number, lon: number) => [number, number];

/** Fit everything into the box with padding, north up. */
function useProjection(width: number, height: number, lines: MapLine[], sf?: StartFinishLine | null): Project | null {
  return useMemo(() => {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    const add = (lat: number, lon: number) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    };
    for (const l of lines) for (let i = 0; i < l.lat.length; i++) add(l.lat[i], l.lon[i]);
    if (sf) {
      add(sf.a.lat, sf.a.lon);
      add(sf.b.lat, sf.b.lon);
    }
    if (!Number.isFinite(minLat)) return null;
    const midLat = (minLat + maxLat) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const w = Math.max((maxLon - minLon) * kx, 1e-5);
    const h = Math.max(maxLat - minLat, 1e-5);
    const pad = 18;
    const scale = Math.min((width - pad * 2) / w, (height - pad * 2) / h);
    const ox = (width - w * scale) / 2;
    const oy = (height - h * scale) / 2;
    return (lat, lon) => [ox + (lon - minLon) * kx * scale, height - oy - (lat - minLat) * scale];
  }, [width, height, lines, sf]);
}

const pts = (p: Project, lat: number[], lon: number[], from = 0, to = lat.length) => {
  let s = '';
  for (let i = from; i < to; i++) {
    const [x, y] = p(lat[i], lon[i]);
    s += `${x.toFixed(1)},${y.toFixed(1)} `;
  }
  return s;
};

/** Static layer: only re-renders when a lap finishes or the line moves. */
const Base = memo(function Base({ p, lines, sf, splits, markers }: { p: Project; lines: MapLine[]; sf?: StartFinishLine | null; splits?: TrackMapProps['splits']; markers?: TrackMapProps['markers'] }) {
  return (
    <G>
      {lines.map((l, li) => {
        const w = l.width ?? 4;
        if (!l.v && !l.colors) {
          return <Polyline key={li} points={pts(p, l.lat, l.lon)} fill="none" stroke={l.color ?? C.faint} strokeWidth={w} strokeOpacity={l.opacity ?? 1} strokeLinejoin="round" strokeLinecap="round" />;
        }
        // Speed colouring: ~150 short polylines, each coloured by its average speed.
        const v = l.v ?? [];
        const n = l.lat.length;
        const min = Math.min(...v);
        const max = Math.max(...v);
        const chunk = Math.max(2, Math.ceil(n / 150));
        const parts = [];
        for (let i = 0; i < n - 1; i += chunk) {
          const end = Math.min(n, i + chunk + 1);
          let sum = 0;
          for (let k = i; k < end; k++) sum += v[k];
          const t = (sum / (end - i) - min) / (max - min || 1);
          const stroke = l.colors ? l.colors[Math.min(n - 1, i + (chunk >> 1))] : ramp(SPEED_STOPS, t);
          parts.push(<Polyline key={i} points={pts(p, l.lat, l.lon, i, end)} fill="none" stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />);
        }
        return <G key={li}>{parts}</G>;
      })}
      {splits?.map((s, i) => {
        const [x, y] = p(s.lat, s.lon);
        return (
          <G key={i}>
            <Circle cx={x} cy={y} r={4} fill={C.bg} stroke={C.text} strokeWidth={2} />
            <SvgText fontFamily={svgFont} x={x + 8} y={y - 6} fill={C.dim} fontSize={11} fontWeight="700">{`S${i + 1}`}</SvgText>
          </G>
        );
      })}
      {markers?.map((m, i) => {
        const [x, y] = p(m.lat, m.lon);
        return <Circle key={`m${i}`} cx={x} cy={y} r={4.5} fill={m.color} stroke={C.bg} strokeWidth={1.5} />;
      })}
      {sf && <SfLine p={p} sf={sf} />}
    </G>
  );
});

function SfLine({ p, sf }: { p: Project; sf: StartFinishLine }) {
  const [x1, y1] = p(sf.a.lat, sf.a.lon);
  const [x2, y2] = p(sf.b.lat, sf.b.lon);
  return (
    <G>
      <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.text} strokeWidth={5} strokeLinecap="round" />
      <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.bg} strokeWidth={5} strokeDasharray="3,3" />
    </G>
  );
}

export function TrackMap({ width, height, lines, trail, car, startFinish, splits, markers }: TrackMapProps) {
  // Until a lap exists, fit the map to the trail so far.
  const fitLines = useMemo(() => (lines.length ? lines : trail ? [trail] : []), [lines, trail]);
  const p = useProjection(width, height, fitLines, startFinish);
  if (!p) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>Waiting for GPS…</Text>
      </View>
    );
  }
  const carXY = car && Number.isFinite(car.lat) ? p(car.lat, car.lon) : null;
  return (
    <Svg width={width} height={height}>
      <Base p={p} lines={lines} sf={startFinish} splits={splits} markers={markers} />
      {trail && trail.lat.length > 1 && (
        <Polyline points={pts(p, trail.lat, trail.lon)} fill="none" stroke={C.text} strokeOpacity={lines.length ? 0.35 : 0.8} strokeWidth={lines.length ? 2 : 4} strokeLinejoin="round" strokeLinecap="round" />
      )}
      {carXY && (
        <G>
          <Circle cx={carXY[0]} cy={carXY[1]} r={13} fill={C.accent} fillOpacity={0.22} />
          <Circle cx={carXY[0]} cy={carXY[1]} r={6.5} fill={C.accent} stroke={C.bg} strokeWidth={2} />
        </G>
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: C.faint, fontWeight: '700', letterSpacing: 1 },
});
