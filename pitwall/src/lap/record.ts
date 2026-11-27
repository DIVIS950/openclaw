import type { CompletedLap } from './LapTimer';

/**
 * A lap as stored on the phone: one array per channel ("columns"), sampled at
 * 12.5 Hz. Compact as JSON and easy to plot.
 */
export interface LapTrace {
  t: number[]; // ms into lap
  d: number[]; // metres into lap
  lat: number[];
  lon: number[];
  v: number[]; // km/h
  tfl: number[];
  tfr: number[];
  trl: number[];
  trr: number[];
  bfl: number[];
  bfr: number[];
  coolant: number[];
  oil: number[];
  egt: number[];
}

export interface SavedLap {
  number: number;
  timeMs: number;
  sectorsMs: [number, number, number];
  distanceM: number;
  maxKmh: number;
  trace: LapTrace;
}

/** Store every 2nd frame: 12.5 Hz is plenty for maps and graphs. */
const KEEP_EVERY = 2;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r7 = (n: number) => Math.round(n * 1e7) / 1e7;

export function lapToSaved(lap: CompletedLap): SavedLap {
  const tr: LapTrace = { t: [], d: [], lat: [], lon: [], v: [], tfl: [], tfr: [], trl: [], trr: [], bfl: [], bfr: [], coolant: [], oil: [], egt: [] };
  const n = lap.frames.length;
  let maxKmh = 0;
  for (let i = 0; i < n; i++) {
    const f = lap.frames[i];
    maxKmh = Math.max(maxKmh, f.speedKmh);
    if (i % KEEP_EVERY !== 0 && i !== n - 1) continue;
    tr.t.push(Math.round(lap.lapT[i]));
    tr.d.push(r1(lap.lapD[i]));
    tr.lat.push(r7(f.lat));
    tr.lon.push(r7(f.lon));
    tr.v.push(r1(f.speedKmh));
    tr.tfl.push(r1(f.tyre.fl));
    tr.tfr.push(r1(f.tyre.fr));
    tr.trl.push(r1(f.tyre.rl));
    tr.trr.push(r1(f.tyre.rr));
    tr.bfl.push(Math.round(f.brake.fl));
    tr.bfr.push(Math.round(f.brake.fr));
    tr.coolant.push(r1(f.coolant));
    tr.oil.push(r1(f.oil));
    tr.egt.push(Math.round(f.egt));
  }
  return {
    number: lap.number,
    timeMs: Math.round(lap.timeMs),
    sectorsMs: lap.sectorsMs.map(Math.round) as [number, number, number],
    distanceM: r1(lap.distanceM),
    maxKmh: r1(maxKmh),
    trace: tr,
  };
}

