/**
 * A fake ~1.8 km club circuit with 10 corners, plus a simple lap-time
 * simulation (grip-limited corners, braking + acceleration limits) that turns
 * it into a realistic speed profile for a ~100 hp front-wheel-drive race car.
 */
import type { XY } from '../../lap/geo';

export const TRACK_LENGTH_M = 1800;
/** Sample spacing of the centreline in metres. */
export const STEP_M = 2;

/** Where the fake circuit is on the planet (a field in North Bohemia). */
export const ORIGIN = { lat: 50.5241, lon: 13.5781 };

/**
 * The layout as straights (S, metres) and arcs (C, degrees, radius m),
 * driven counter-clockwise from the middle of the main straight (start/finish).
 * Positive degrees = left turn. Turns add up to 360°. The two straights marked
 * `null` are solved automatically so the loop closes exactly.
 */
type Piece = ['S', number | null] | ['C', number, number];
const LAYOUT: Piece[] = [
  ['S', 260],
  ['C', 90, 26], // T1  tight left at the end of the main straight
  ['S', 120],
  ['C', -35, 60], // T2  fast right kink
  ['S', 60],
  ['C', 80, 36], // T3  left
  ['S', 90],
  ['C', -70, 32], // T4  right
  ['S', 70],
  ['C', 150, 17], // T5  hairpin
  ['S', 110],
  ['C', -60, 42], // T6  right
  ['S', 80],
  ['C', 70, 46], // T7  left
  ['S', 130],
  ['C', 45, 85], // T8  long fast left
  ['S', null], // back straight (solved: closes north/south)
  ['C', -40, 50], // T9  right
  ['S', 50],
  ['C', 130, 30], // T10 last corner onto the main straight
  ['S', null], // final straight (solved: closes east/west)
];

export interface Circuit {
  /** Centreline points every STEP_M metres, closed loop (last → first). */
  pts: XY[];
  /** Signed curvature 1/m (positive = left turn). */
  curvature: number[];
  length: number;
}

/** Walk the layout like a turtle, emitting a point every STEP_M metres. */
function walk(layout: [string, number, number][]) {
  const pts: XY[] = [];
  const curvature: number[] = [];
  let x = 0;
  let y = 0;
  let h = 0; // radians, 0 = east
  for (const [kind, a, r] of layout) {
    const len = kind === 'S' ? a : (Math.abs(a) * Math.PI * r) / 180;
    const k = kind === 'S' ? 0 : Math.sign(a) / r;
    const n = Math.max(1, Math.round(len / STEP_M));
    const ds = len / n;
    for (let i = 0; i < n; i++) {
      pts.push({ x, y });
      curvature.push(k);
      x += Math.cos(h + (k * ds) / 2) * ds;
      y += Math.sin(h + (k * ds) / 2) * ds;
      h += k * ds;
    }
  }
  return { pts, curvature, end: { x, y } };
}

function buildCircuit(): Circuit {
  // Solve the two open straights: first with both at 0 to see the gap, then
  // the back straight (heading south) fixes y and the final straight fixes x.
  const resolve = (back: number, final: number) =>
    LAYOUT.map((p, i): [string, number, number] => {
      if (p[0] === 'S') return ['S', p[1] ?? (i === LAYOUT.length - 1 ? final : back), 0];
      return ['C', p[1], p[2]];
    });
  const gap = walk(resolve(0, 0)).end;
  const back = gap.y; // back straight runs due south
  const final = -gap.x; // final straight runs due east
  const { pts, curvature } = walk(resolve(back, final));

  // Scale to the target length (radii scale too, the shape stays the same).
  const scale = TRACK_LENGTH_M / (pts.length * STEP_M);
  return {
    pts: pts.map((p) => ({ x: p.x * scale, y: p.y * scale })),
    curvature: curvature.map((k) => k / scale),
    length: TRACK_LENGTH_M,
  };
}

export const CIRCUIT = buildCircuit();

/** Car limits (m/s, m/s²). A light, well sorted Fabia on semi-slicks. */
const V_MAX = 172 / 3.6;
const A_LAT = 12.0;
const A_BRAKE = 10.5;
const accelAt = (v: number) => Math.max(0.4, 4.2 * (1 - v / (195 / 3.6)));

/**
 * Speed (m/s) at every centreline sample for one lap.
 * `grip(i)` scales cornering + braking for that sample, used to make each lap
 * slightly different.
 */
export function speedProfile(grip: (i: number) => number): number[] {
  const { curvature } = CIRCUIT;
  const m = curvature.length;
  const v = curvature.map((k, i) => Math.min(V_MAX, Math.sqrt((A_LAT * grip(i)) / Math.max(Math.abs(k), 1e-6))));
  // Braking: walk backwards, going round twice so the loop closes cleanly.
  for (let pass = 0; pass < 2 * m; pass++) {
    const i = (m - 1 - (pass % m) + m) % m;
    const next = v[(i + 1) % m];
    v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * A_BRAKE * grip(i) * STEP_M));
  }
  // Acceleration: walk forwards, twice as well.
  for (let pass = 0; pass < 2 * m; pass++) {
    const i = pass % m;
    const prev = v[(i - 1 + m) % m];
    v[i] = Math.min(v[i], Math.sqrt(prev * prev + 2 * accelAt(prev) * STEP_M));
  }
  return v;
}

/** Corners = local speed minima well below top speed. Used by the sim check. */
export function countCorners(v: number[]): number {
  let corners = 0;
  const m = v.length;
  for (let i = 0; i < m; i++) {
    let isMin = v[i] < V_MAX * 0.92;
    for (let k = 1; k <= 15 && isMin; k++) {
      if (v[(i + k) % m] < v[i] || v[(i - k + m) % m] <= v[i]) isMin = false;
    }
    if (isMin) corners++;
  }
  return corners;
}
