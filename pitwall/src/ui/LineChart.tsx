import { memo } from 'react';
import Svg, { G, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { C, svgFont } from './theme';

export interface Series {
  x: number[];
  y: number[];
  color: string;
  width?: number;
}

interface Props {
  width: number;
  height: number;
  series: Series[];
  /** Fixed y range; otherwise fitted to the data. */
  yMin?: number;
  yMax?: number;
  /** Draws a dashed line at this y (e.g. 0 on a delta chart). */
  zero?: number;
  formatY?: (v: number) => string;
  /** x axis is metres; labels are shown in km. */
  xUnit?: string;
}

const PAD_L = 38;
const PAD_B = 18;
const PAD_T = 6;

/** Simple multi-series line chart over distance. */
export const LineChart = memo(function LineChart({ width, height, series, yMin, yMax, zero, formatY = (v) => String(Math.round(v)), xUnit = 'km' }: Props) {
  const xs = series.flatMap((s) => s.x);
  const ys = series.flatMap((s) => s.y.filter(Number.isFinite));
  if (!xs.length || !ys.length) return <Svg width={width} height={height} />;
  const x0 = 0;
  const x1 = Math.max(...xs);
  let y0 = yMin ?? Math.min(...ys);
  let y1 = yMax ?? Math.max(...ys);
  if (y1 - y0 < 1e-6) {
    y0 -= 1;
    y1 += 1;
  }
  const pad = (y1 - y0) * 0.08;
  if (yMin === undefined) y0 -= pad;
  if (yMax === undefined) y1 += pad;
  const w = width - PAD_L;
  const h = height - PAD_B - PAD_T;
  const sx = (x: number) => PAD_L + ((x - x0) / (x1 - x0 || 1)) * w;
  const sy = (y: number) => PAD_T + h - ((y - y0) / (y1 - y0)) * h;
  const grid = [0, 0.5, 1].map((f) => y0 + (y1 - y0) * f);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => x0 + (x1 - x0) * f);

  return (
    <Svg width={width} height={height}>
      {grid.map((g, i) => (
        <G key={i}>
          <Line x1={PAD_L} x2={width} y1={sy(g)} y2={sy(g)} stroke={C.line} strokeWidth={1} />
          <SvgText fontFamily={svgFont} x={PAD_L - 6} y={sy(g) + 4} fill={C.faint} fontSize={10} fontWeight="600" textAnchor="end">
            {formatY(g)}
          </SvgText>
        </G>
      ))}
      {zero !== undefined && zero > y0 && zero < y1 && (
        <Line x1={PAD_L} x2={width} y1={sy(zero)} y2={sy(zero)} stroke={C.dim} strokeDasharray="4,4" strokeWidth={1} />
      )}
      {ticks.map((t, i) => (
        <SvgText fontFamily={svgFont} key={i} x={sx(t)} y={height - 4} fill={C.faint} fontSize={10} fontWeight="600" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>
          {`${(t / 1000).toFixed(1)}${i === 4 ? ` ${xUnit}` : ''}`}
        </SvgText>
      ))}
      {series.map((s, i) => {
        let pts = '';
        for (let k = 0; k < s.x.length; k++) {
          if (!Number.isFinite(s.y[k])) continue;
          pts += `${sx(s.x[k]).toFixed(1)},${sy(s.y[k]).toFixed(1)} `;
        }
        return <Polyline key={i} points={pts} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeLinejoin="round" />;
      })}
    </Svg>
  );
});
