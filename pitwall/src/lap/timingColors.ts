import { C } from '../ui/theme';

/** Anything with sector times, e.g. a SavedLap. */
interface Timed {
  timeMs: number;
  sectorsMs: number[];
}

/**
 * F1-style colour for a sector time:
 *  purple = best of the session, green = better than the previous lap, yellow = slower.
 * `laps` are the completed laps to compare against (the lap itself may be included).
 */
export function sectorColor(ms: number | null, sector: number, laps: Timed[], previous?: Timed): string {
  if (ms === null) return C.faint;
  const best = Math.min(...laps.map((l) => l.sectorsMs[sector]));
  if (!laps.length || ms <= best) return C.purple;
  if (previous && ms < previous.sectorsMs[sector]) return C.green;
  return C.yellow;
}

/** Purple for the session best lap, white otherwise. */
export function lapColor(ms: number | null, laps: Timed[]): string {
  if (ms === null || !laps.length) return C.text;
  return ms <= Math.min(...laps.map((l) => l.timeMs)) ? C.purple : C.text;
}

/** Delta colours: faster (negative) green, slower red. */
export const deltaColor = (ms: number | null) => (ms === null || Math.abs(ms) < 5 ? C.text : ms < 0 ? C.green : C.red);
