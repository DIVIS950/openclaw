import type { TelemetryFrame } from '../telemetry/types';
import { distanceM, fromLocal, headingVector, segmentIntersection, toLocal, type LatLon, type XY } from './geo';

/** The start/finish line: a short segment across the track. */
export interface StartFinishLine {
  a: LatLon;
  b: LatLon;
  /** Driving direction (degrees) when it was set. Crossings the other way are ignored. */
  heading: number;
}

export interface CompletedLap {
  number: number;
  timeMs: number;
  /** Three sector times, ms. */
  sectorsMs: [number, number, number];
  distanceM: number;
  /** Frames of the lap with time (ms into lap) and distance (m into lap). */
  frames: TelemetryFrame[];
  lapT: number[];
  lapD: number[];
}

export interface LapTimerState {
  /** 0 = out lap (waiting for the first crossing). */
  lapNumber: number;
  lapStartT: number | null;
  currentMs: number;
  distanceM: number;
  /** Live delta to the best lap at the same distance, ms. null = no reference yet. */
  deltaMs: number | null;
  bestMs: number | null;
  lastMs: number | null;
  /** Sector times of the lap in progress (null = not reached yet). */
  currentSectors: (number | null)[];
  /** Distances of the two sector splits, once the first lap is done. */
  sectorSplitsM: [number, number] | null;
}

const LINE_HALF_WIDTH_M = 15;
const MIN_LAP_MS = 15_000;

/** Line across the track at the car's position, square to its heading. */
export function lineAt(lat: number, lon: number, heading: number): StartFinishLine {
  const h = headingVector(heading);
  // Perpendicular to the heading: rotate 90°.
  const px = h.y * LINE_HALF_WIDTH_M;
  const py = -h.x * LINE_HALF_WIDTH_M;
  const c = { lat, lon };
  return { a: fromLocal(c, px, py), b: fromLocal(c, -px, -py), heading };
}

/** Time (ms) at distance `d` in a lap recorded as parallel arrays, linear interpolation. */
export function timeAtDistance(lapD: number[], lapT: number[], d: number): number | null {
  const n = lapD.length;
  if (n < 2 || d < lapD[0] || d > lapD[n - 1]) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lapD[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = lapD[hi] - lapD[lo] || 1;
  return lapT[lo] + ((d - lapD[lo]) / span) * (lapT[hi] - lapT[lo]);
}

/**
 * Feed it every frame with `push()`. It finds start/finish crossings,
 * times laps and sectors, and works out the live delta to the best lap.
 */
export class LapTimer {
  private line: StartFinishLine | null;
  private prev: TelemetryFrame | null = null;
  private lapStartT: number | null = null;
  private lapNumber = 0;
  private distance = 0;
  private frames: TelemetryFrame[] = [];
  private lapT: number[] = [];
  private lapD: number[] = [];
  private best: { ms: number; lapT: number[]; lapD: number[]; xy: XY[] } | null = null;
  /** Index into the best lap of the point the car is level with. */
  private refIdx = 0;
  private lastMs: number | null = null;
  private splits: [number, number] | null = null;
  private sectors: (number | null)[] = [null, null, null];
  private deltaMs: number | null = null;

  constructor(line: StartFinishLine | null) {
    this.line = line;
  }

  getLine() {
    return this.line;
  }

  /**
   * Move the start/finish line to where the car is now. Starts a fresh lap
   * immediately and drops the delta reference (it was measured from the old line).
   */
  setLineHere(frame: TelemetryFrame) {
    this.line = lineAt(frame.lat, frame.lon, frame.heading);
    this.best = null;
    this.splits = null;
    this.startLap(frame.t, 0);
    this.prev = frame;
    this.addSample(frame);
  }

  state(): LapTimerState {
    return {
      lapNumber: this.lapNumber,
      lapStartT: this.lapStartT,
      currentMs: this.prev && this.lapStartT !== null ? this.prev.t - this.lapStartT : 0,
      distanceM: this.distance,
      deltaMs: this.deltaMs,
      bestMs: this.best?.ms ?? null,
      lastMs: this.lastMs,
      currentSectors: [...this.sectors],
      sectorSplitsM: this.splits,
    };
  }

  /** Returns the finished lap when this frame completed one. */
  push(frame: TelemetryFrame): CompletedLap | null {
    if (!Number.isFinite(frame.lat) || !Number.isFinite(frame.lon)) return null;

    // No line yet: put it where the car is and start lap 1 right away.
    if (!this.line) {
      this.setLineHere(frame);
      return null;
    }

    const prev = this.prev;
    this.prev = frame;
    if (!prev) {
      if (this.lapStartT !== null) this.addSample(frame);
      return null;
    }

    const step = distanceM(prev, frame);
    const crossing = this.findCrossing(prev, frame);
    let completed: CompletedLap | null = null;

    if (crossing !== null && (this.lapStartT === null || crossing.t - this.lapStartT >= MIN_LAP_MS)) {
      const crossT = crossing.t;
      if (this.lapStartT !== null) {
        // Close the lap with an interpolated point exactly on the line.
        this.lapT.push(crossT - this.lapStartT);
        this.lapD.push(this.distance + step * crossing.frac);
        completed = this.finishLap(crossT - this.lapStartT);
      }
      this.startLap(crossT, step * (1 - crossing.frac));
      this.addSample(frame);
      return completed;
    }

    if (this.lapStartT === null) return null; // still on the out lap
    this.distance += step;
    this.addSample(frame);
    return null;
  }

  private startLap(t: number, distance: number) {
    this.lapStartT = t;
    this.lapNumber += 1;
    this.distance = distance;
    this.frames = [];
    this.lapT = [];
    this.lapD = [];
    this.sectors = [null, null, null];
    this.deltaMs = this.best ? 0 : null;
    this.refIdx = 0;
  }

  private addSample(frame: TelemetryFrame) {
    if (this.lapStartT === null) return;
    const t = frame.t - this.lapStartT;
    this.frames.push(frame);
    this.lapT.push(t);
    this.lapD.push(this.distance);

    // Live sector splits.
    if (this.splits) {
      for (let s = 0; s < 2; s++) {
        if (this.sectors[s] === null && this.distance >= this.splits[s]) {
          const at = timeAtDistance(this.lapD, this.lapT, this.splits[s]) ?? t;
          this.sectors[s] = at - (s === 0 ? 0 : (this.sectors[0] ?? 0));
        }
      }
    }

    // Live delta: how long did the best lap take to get to this same point?
    if (this.best) {
      const ref = this.referenceTime(frame);
      if (ref !== null) this.deltaMs = t - ref;
    }
  }

  /**
   * Find where the car is on the best lap and return the best lap's time there.
   * Matching by position (not just our own distance) keeps the delta honest
   * when today's line is a few metres longer or shorter than the best lap's.
   */
  private referenceTime(frame: TelemetryFrame): number | null {
    const best = this.best;
    const line = this.line;
    if (!best || !line || best.xy.length < 2) return null;
    const p = toLocal(line.a, frame.lat, frame.lon);
    const n = best.xy.length;
    // Search a window ahead of the last match: the car only moves forwards.
    let bestDist = Infinity;
    let hitT: number | null = null;
    const from = Math.max(0, this.refIdx - 5);
    const to = Math.min(n - 2, this.refIdx + 75);
    for (let i = from; i <= to; i++) {
      const a = best.xy[i];
      const b = best.xy[i + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby || 1;
      const u = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
      const d = Math.hypot(a.x + abx * u - p.x, a.y + aby * u - p.y);
      if (d < bestDist) {
        bestDist = d;
        this.refIdx = i;
        hitT = best.lapT[i] + u * (best.lapT[i + 1] - best.lapT[i]);
      }
    }
    // Way off the reference (e.g. a spin onto the grass): fall back to distance.
    if (bestDist > 25) return timeAtDistance(best.lapD, best.lapT, this.distance);
    return hitT;
  }

  private finishLap(timeMs: number): CompletedLap {
    const distanceM = this.lapD[this.lapD.length - 1];
    if (!this.splits) this.splits = [distanceM / 3, (2 * distanceM) / 3];
    const t1 = timeAtDistance(this.lapD, this.lapT, this.splits[0]) ?? timeMs / 3;
    const t2 = timeAtDistance(this.lapD, this.lapT, this.splits[1]) ?? (2 * timeMs) / 3;
    const lap: CompletedLap = {
      number: this.lapNumber,
      timeMs,
      sectorsMs: [t1, t2 - t1, timeMs - t2],
      distanceM,
      frames: this.frames,
      lapT: this.lapT,
      lapD: this.lapD,
    };
    this.lastMs = timeMs;
    if (!this.best || timeMs < this.best.ms) {
      const origin = this.line!.a;
      // The closing point sits on the line; reuse the last frame's position for it.
      const xy = this.frames.map((f) => toLocal(origin, f.lat, f.lon));
      const end = this.line ? toLocal(origin, (this.line.a.lat + this.line.b.lat) / 2, (this.line.a.lon + this.line.b.lon) / 2) : xy[xy.length - 1];
      xy.push(end);
      this.best = { ms: timeMs, lapT: this.lapT, lapD: this.lapD, xy };
    }
    return lap;
  }

  /** Did prev→frame cross the line in the driving direction? Returns the exact crossing time. */
  private findCrossing(prev: TelemetryFrame, frame: TelemetryFrame): { t: number; frac: number } | null {
    const line = this.line;
    if (!line) return null;
    const origin = line.a;
    const p1 = toLocal(origin, prev.lat, prev.lon);
    const p2 = toLocal(origin, frame.lat, frame.lon);
    const hit = segmentIntersection(p1, p2, toLocal(origin, line.a.lat, line.a.lon), toLocal(origin, line.b.lat, line.b.lon));
    // A frame sitting exactly on the line can match two segments; MIN_LAP_MS stops the double count.
    if (!hit) return null;
    const dir = headingVector(line.heading);
    if ((p2.x - p1.x) * dir.x + (p2.y - p1.y) * dir.y <= 0) return null;
    return { t: prev.t + hit.t * (frame.t - prev.t), frac: hit.t };
  }
}
