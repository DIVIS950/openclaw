// "You've been in the shop for 2 minutes: use your card." Pure bookkeeping, so it can
// be tested: the app calls `dwellStep` on every location fix and every few seconds.

/** How long a shop must be out of reach before the visit counts as over. */
export const LEAVE_GRACE_MS = 90_000;
/** Don't remind about the same card again within this time. */
export const REPEAT_AFTER_MS = 3 * 3600_000;

/**
 * @typedef {{
 *   since: Record<string, number>,
 *   seen: Record<string, number>,
 *   done: Record<string, number>,
 * }} DwellState
 */

/** @returns {DwellState} */
export function emptyDwell() {
  return { since: {}, seen: {}, done: {} };
}

/**
 * Advance the visit clocks.
 * @param {DwellState} prev
 * @param {{ hereIds: string[], now: number, thresholdMs: number }} input
 * @returns {{ next: DwellState, due: string[] }} `due`: cards to remind about now
 */
export function dwellStep(prev, { hereIds, now, thresholdMs }) {
  const since = { ...prev.since };
  const seen = { ...prev.seen };
  const done = { ...prev.done };
  const here = new Set(hereIds);
  for (const id of here) {
    since[id] ??= now;
    seen[id] = now;
  }
  // A short GPS jump outside the shop doesn't end the visit; a real walk-out does.
  for (const id of Object.keys(since)) {
    if (!here.has(id) && now - (seen[id] ?? 0) > LEAVE_GRACE_MS) {
      delete since[id];
      delete seen[id];
    }
  }
  const due = [];
  for (const id of here) {
    const recentlyDone = done[id] !== undefined && now - done[id] < REPEAT_AFTER_MS;
    if (now - since[id] >= thresholdMs && !recentlyDone) {
      due.push(id);
      done[id] = now;
    }
  }
  return { next: { since, seen, done }, due };
}

/** True while some visit is still waiting for its reminder. */
export function dwellPending(state, now, thresholdMs) {
  return Object.entries(state.since).some(
    ([id, start]) => now - start < thresholdMs && !(state.done[id] !== undefined && now - state.done[id] < REPEAT_AFTER_MS),
  );
}
