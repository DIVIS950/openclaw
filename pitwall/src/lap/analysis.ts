import type { LapTrace } from './record';
import { C, ramp } from '../ui/palette';

/**
 * Where the driver starts braking: the first sample of every stretch where
 * the car slows harder than ~0.5 g. Returns trace indices.
 */
export function brakingPoints(tr: LapTrace, thresholdMs2 = 5): number[] {
  const out: number[] = [];
  const k = 3; // compare ~0.25 s apart at 12.5 Hz to smooth GPS speed noise
  let braking = false;
  let lastD = -Infinity;
  for (let i = 0; i + k < tr.v.length; i++) {
    const dt = (tr.t[i + k] - tr.t[i]) / 1000;
    const decel = dt > 0 ? (tr.v[i] - tr.v[i + k]) / 3.6 / dt : 0;
    if (!braking && decel > thresholdMs2) {
      braking = true;
      if (tr.d[i] - lastD > 50) out.push(i);
      lastD = tr.d[i];
    } else if (braking && decel < thresholdMs2 * 0.4) {
      braking = false;
    }
  }
  return out;
}

/**
 * Colour for every point of lap A by whether lap B is gaining (green) or
 * losing (red) time there, from the slope of the time gap over ~40 m.
 * `gap` is B − A in seconds at A's distances (see timeDelta).
 */
export function gainLossColors(aD: number[], gap: { d: number[]; dt: number[] }): string[] {
  const { d, dt } = gap;
  const slope = d.map((x, i) => {
    let j = i;
    while (j < d.length - 1 && d[j] - x < 40) j++;
    return j > i ? (dt[j] - dt[i]) / (d[j] - x) : 0; // s per metre
  });
  const max = Math.max(1e-4, ...slope.map(Math.abs)) * 0.35;
  const neutral = '#3A4048'; // same pace
  const colorAt = (s: number) => (s < 0 ? ramp([neutral, C.green], -s / max) : ramp([neutral, C.red], s / max));
  // Map onto every point of A (gap may stop short if B is shorter).
  return aD.map((x) => {
    let i = d.findIndex((y) => y >= x);
    if (i < 0) i = d.length - 1;
    return colorAt(slope[i] ?? 0);
  });
}
