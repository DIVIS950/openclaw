import type { LapTrace, SavedLap } from '../storage/sessions';

export function bestLap<T extends { timeMs: number }>(laps: T[]): T | null {
  return laps.reduce<T | null>((b, l) => (!b || l.timeMs < b.timeMs ? l : b), null);
}

/** Position on a stored lap at `d` metres into it. */
export function pointAtDistance(tr: LapTrace, d: number): { lat: number; lon: number } | null {
  const i = tr.d.findIndex((x) => x >= d);
  if (i < 0) return null;
  return { lat: tr.lat[i], lon: tr.lon[i] };
}

/** Sum of the best individual sectors: the lap you could do if it all came together. */
export function idealLapMs(laps: SavedLap[]): number | null {
  if (!laps.length) return null;
  return [0, 1, 2].reduce((sum, i) => sum + Math.min(...laps.map((l) => l.sectorsMs[i])), 0);
}

/**
 * Time difference along the lap between two laps (b minus a), sampled on a's
 * distance points. Positive = b is behind.
 */
export function timeDelta(a: LapTrace, b: LapTrace): { d: number[]; dt: number[] } {
  const d: number[] = [];
  const dt: number[] = [];
  let j = 0;
  for (let i = 0; i < a.d.length; i++) {
    const x = a.d[i];
    while (j < b.d.length - 2 && b.d[j + 1] < x) j++;
    if (x > b.d[b.d.length - 1]) break;
    const span = b.d[j + 1] - b.d[j] || 1;
    const tb = b.t[j] + ((x - b.d[j]) / span) * (b.t[j + 1] - b.t[j]);
    d.push(x);
    dt.push((tb - a.t[i]) / 1000);
  }
  return { d, dt };
}
