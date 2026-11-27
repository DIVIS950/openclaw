import { fromLocal } from '../lap/geo';
import { BaseSource } from './BaseSource';
import { CIRCUIT, ORIGIN, STEP_M, speedProfile } from './sim/circuit';
import type { TelemetryFrame } from './types';

const HZ = 25;
const DT = 1 / HZ;
const AMBIENT = 18;

/** Deterministic-per-instance random numbers (so `sim:check` is repeatable). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** A smooth random wave along the lap: sum of a few sines with random phases. */
function wave(rand: () => number, amplitude: number, harmonics: number[]) {
  const phases = harmonics.map(() => rand() * Math.PI * 2);
  const weights = harmonics.map(() => 0.5 + rand());
  const norm = weights.reduce((a, b) => a + b, 0);
  return (frac: number) =>
    (amplitude / norm) * harmonics.reduce((sum, h, i) => sum + weights[i] * Math.sin(h * 2 * Math.PI * frac + phases[i]), 0);
}

/**
 * The physics of the fake car. Call `step()` 25 times per simulated second.
 * No timers in here, so it can be run headless by scripts/sim-check.ts.
 */
export class SimulatorModel {
  private rand: () => number;
  private s = 0; // metres into the lap
  private v: number; // m/s
  private profile: number[] = [];
  private lineOffset: (frac: number) => number = () => 0;
  private frame = 0;
  private sessionT = 0; // seconds since start
  private throttle = 0;
  private sats = 15;

  // Temperatures (°C). Everything starts cold.
  private tyre = { fl: 24, fr: 24, rl: 22, rr: 22 };
  private brake = { fl: 60, fr: 60 };
  private egt = 420;

  constructor(seed = Date.now()) {
    this.rand = rng(seed);
    this.newLap();
    // Rolling start 20 m before the start/finish line.
    this.s = CIRCUIT.pts.length * STEP_M - 20;
    this.v = this.profile[CIRCUIT.pts.length - 10];
  }

  private gauss() {
    // Box-Muller
    return Math.sqrt(-2 * Math.log(this.rand() || 1e-9)) * Math.cos(2 * Math.PI * this.rand());
  }

  /** Pick this lap's grip (cold tyres = less grip) and driving line. */
  private newLap() {
    const avgTyre = (this.tyre.fl + this.tyre.fr + this.tyre.rl + this.tyre.rr) / 4;
    const warm = Math.min(1, Math.max(0, (avgTyre - 30) / 45));
    const tyreGrip = 0.9 + 0.1 * warm;
    const lapGrip = 1 + (this.rand() - 0.5) * 0.034; // driver consistency ≈ ±0.5 s
    const local = wave(this.rand, 0.03, [3, 5, 7, 11]); // braver in some corners than others
    const m = CIRCUIT.pts.length;
    this.profile = speedProfile((i) => tyreGrip * lapGrip * (1 + local(i / m)));
    this.lineOffset = wave(this.rand, 1.4, [4, 9, 13]);
  }

  step(): TelemetryFrame {
    const { pts, curvature } = CIRCUIT;
    const m = pts.length;
    const L = m * STEP_M;

    // --- Motion ---------------------------------------------------------
    const prevV = this.v;
    const idx = this.s / STEP_M;
    const i0 = Math.floor(idx) % m;
    const i1 = (i0 + 1) % m;
    const f = idx - Math.floor(idx);
    this.v = this.profile[i0] * (1 - f) + this.profile[i1] * f;
    this.s += this.v * DT;
    if (this.s >= L) {
      this.s -= L;
      this.newLap();
    }
    this.sessionT += DT;
    this.frame++;

    const aLon = (this.v - prevV) / DT; // m/s², + = accelerating
    const k = curvature[i0];
    const gLat = (this.v * this.v * k) / 9.81; // + = left turn → loads the right side
    const gLon = aLon / 9.81;

    // --- GPS position: centreline + driving line offset + receiver noise --
    const a = pts[i0];
    const b = pts[i1];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const tl = Math.hypot(tx, ty) || 1;
    const nx = -ty / tl;
    const ny = tx / tl;
    const off = this.lineOffset(this.s / L);
    const x = a.x + tx * f + nx * off + this.gauss() * 0.08;
    const y = a.y + ty * f + ny * off + this.gauss() * 0.08;
    const pos = fromLocal(ORIGIN, x, y);
    const heading = ((Math.atan2(tx, ty) * 180) / Math.PI + 360) % 360;

    // --- Tyres: heated by load, cooled by airflow -------------------------
    const roll = 0.012 * this.v;
    const lat = (side: 1 | -1) => 0.085 * this.v * Math.max(0, side * gLat);
    const brakeLoad = (front: boolean) => 0.1 * this.v * Math.max(0, -gLon) * (front ? 0.7 : 0.3);
    const drive = (front: boolean) => (front ? 0.16 * this.v * Math.max(0, gLon) : 0); // front-wheel drive
    const cool = 0.003 + 0.0006 * this.v;
    const heatTyre = (t: number, q: number) => t + (q - (t - AMBIENT) * cool) * DT;
    this.tyre = {
      fl: heatTyre(this.tyre.fl, roll + lat(-1) + brakeLoad(true) + drive(true)),
      fr: heatTyre(this.tyre.fr, roll + lat(1) + brakeLoad(true) + drive(true)),
      rl: heatTyre(this.tyre.rl, roll * 1.6 + lat(-1) * 1.1 + brakeLoad(false)),
      rr: heatTyre(this.tyre.rr, roll * 1.6 + lat(1) * 1.1 + brakeLoad(false)),
    };

    // --- Brakes: braking power in, airflow out. Left disc runs a bit hotter.
    const brakePower = Math.max(0, -aLon) * this.v;
    const brakeCool = 0.012 + 0.0011 * this.v;
    const heatDisc = (t: number, share: number) => t + (0.62 * brakePower * share - (t - AMBIENT) * brakeCool) * DT;
    this.brake = { fl: heatDisc(this.brake.fl, 1.06), fr: heatDisc(this.brake.fr, 0.97) };

    // --- Engine: slow warm-up through the session, EGT follows throttle ---
    const target = aLon > 0.3 ? Math.min(1, 0.55 + aLon / 5) : aLon < -1 ? 0 : 0.35;
    this.throttle += (target - this.throttle) * Math.min(1, DT / 0.25);
    this.egt += (430 + 420 * this.throttle + this.v * 1.2 - this.egt) * Math.min(1, DT / 0.6);
    const coolant = 80 + 27 * (1 - Math.exp(-this.sessionT / 300)) + 1.5 * this.throttle;
    const oil = 74 + 44 * (1 - Math.exp(-this.sessionT / 420));

    if (this.frame % 250 === 0) this.sats = Math.max(11, Math.min(19, this.sats + Math.round(this.gauss())));

    const r1 = (n: number) => Math.round(n * 10) / 10;
    return {
      t: Math.round(this.frame * DT * 1000),
      lat: pos.lat,
      lon: pos.lon,
      speedKmh: r1(Math.max(0, this.v * 3.6 + this.gauss() * 0.15)),
      heading: r1(heading),
      sats: this.sats,
      gpsHz: HZ,
      tyre: {
        fl: r1(this.tyre.fl + this.gauss() * 0.3),
        fr: r1(this.tyre.fr + this.gauss() * 0.3),
        rl: r1(this.tyre.rl + this.gauss() * 0.3),
        rr: r1(this.tyre.rr + this.gauss() * 0.3),
      },
      brake: { fl: r1(this.brake.fl + this.gauss() * 2), fr: r1(this.brake.fr + this.gauss() * 2) },
      coolant: r1(coolant + this.gauss() * 0.15),
      oil: r1(oil + this.gauss() * 0.15),
      egt: r1(this.egt + this.gauss() * 6),
      battV: Math.round((13.85 - 0.25 * this.throttle + this.gauss() * 0.03) * 100) / 100,
    };
  }
}

/**
 * Fake data source: drives SimulatorModel in real time at 25 Hz.
 * If the phone falls behind (or the app was in the background) it catches up
 * at most one second of frames, then skips ahead.
 */
export class SimulatorSource extends BaseSource {
  readonly kind = 'simulator' as const;
  private model: SimulatorModel | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private emitted = 0;

  async connect() {
    if (this.timer) return;
    this.setStatus('connecting');
    this.model = new SimulatorModel();
    this.startedAt = Date.now();
    this.emitted = 0;
    this.timer = setInterval(() => this.tick(), 1000 / HZ);
    this.setStatus('connected');
  }

  async disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.model = null;
    this.setStatus('disconnected');
  }

  private tick() {
    if (!this.model) return;
    const due = Math.floor(((Date.now() - this.startedAt) * HZ) / 1000);
    let behind = due - this.emitted;
    if (behind > HZ) {
      // Too far behind (app was suspended): drop the gap instead of fast-forwarding.
      this.emitted = due - 1;
      behind = 1;
    }
    for (let i = 0; i < behind; i++) {
      this.emitted++;
      this.emitFrame(this.model.step());
    }
  }
}
