/**
 * Headless check of the simulator + lap timer. Run: `npm run sim:check`
 * Prints every lap with sectors, delta at the finish and temperature ranges.
 */
import { LapTimer } from '../src/lap/LapTimer';
import { SimulatorModel } from '../src/telemetry/SimulatorSource';

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;

function run(seed: number, laps: number, line: ReturnType<LapTimer['getLine']>) {
  const model = new SimulatorModel(seed);
  const timer = new LapTimer(line);
  let done = 0;
  let lastDelta: number | null = null;
  let frame = model.step();
  const errors: string[] = [];
  while (done < laps) {
    const before = timer.state();
    const lap = timer.push(frame);
    if (lap) {
      done++;
      const r = (xs: number[]) => `${Math.min(...xs).toFixed(0)}-${Math.max(...xs).toFixed(0)}`;
      const f = lap.frames;
      const sumSectors = lap.sectorsMs.reduce((a, b) => a + b, 0);
      if (Math.abs(sumSectors - lap.timeMs) > 1) errors.push(`lap ${lap.number}: sectors do not add up`);
      // The delta just before the line should be ≈ this lap minus the previous best.
      const expected = before.bestMs !== null ? lap.timeMs - before.bestMs : null;
      const deltaNote = expected === null ? '' : `  Δ@line ${(lastDelta! / 1000).toFixed(2)} (exp ${(expected / 1000).toFixed(2)})`;
      if (expected !== null && Math.abs(lastDelta! - expected) > 150) errors.push(`lap ${lap.number}: delta off`);
      console.log(
        `L${String(lap.number).padStart(2)} ${fmt(lap.timeMs)}  S ${lap.sectorsMs.map((s) => (s / 1000).toFixed(2)).join(' / ')}` +
          `  ${lap.distanceM.toFixed(0)}m  tyreFL ${r(f.map((x) => x.tyre.fl))} FR ${r(f.map((x) => x.tyre.fr))} RL ${r(f.map((x) => x.tyre.rl))} RR ${r(f.map((x) => x.tyre.rr))}` +
          `  brkFL ${r(f.map((x) => x.brake.fl))} FR ${r(f.map((x) => x.brake.fr))}  cool ${f[f.length - 1].coolant} oil ${f[f.length - 1].oil} egt ${r(f.map((x) => x.egt))}` +
          deltaNote,
      );
    }
    lastDelta = timer.state().deltaMs;
    frame = model.step();
  }
  return { line: timer.getLine(), errors };
}

console.log('--- Run 1: no start/finish line saved (auto-set at first frame) ---');
const first = run(1234, 12, null);
console.log('--- Run 2: saved line from run 1, different seed ---');
const second = run(98765, 4, first.line);
const errors = [...first.errors, ...second.errors];
if (errors.length) {
  console.error('FAIL\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK');
