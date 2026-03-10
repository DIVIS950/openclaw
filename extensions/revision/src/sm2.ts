import type { Card, ReviewQuality } from "./types.js";

/**
 * SM-2 spaced repetition algorithm.
 * Returns updated card fields after a review with the given quality rating.
 *
 * Quality scale:
 *   5 - perfect response
 *   4 - correct response after a hesitation
 *   3 - correct response recalled with serious difficulty
 *   2 - incorrect response; the correct one seemed easy to recall
 *   1 - incorrect response; the correct one remembered
 *   0 - complete blackout
 */
export function applyReview(
  card: Card,
  quality: ReviewQuality,
  now: Date = new Date(),
): Pick<Card, "repetitions" | "interval" | "easeFactor" | "dueAt" | "lastReviewedAt"> {
  let { repetitions, interval, easeFactor } = card;

  if (quality >= 3) {
    // Correct response
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  } else {
    // Incorrect — reset to beginning
    repetitions = 0;
    interval = 1;
  }

  // Update ease factor (clamp to ≥1.3)
  easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));

  const dueAt = new Date(now);
  dueAt.setDate(dueAt.getDate() + interval);

  return {
    repetitions,
    interval,
    easeFactor,
    dueAt: dueAt.toISOString(),
    lastReviewedAt: now.toISOString(),
  };
}

/** Returns true if the card is due for review on or before `now`. */
export function isDue(card: Card, now: Date = new Date()): boolean {
  return new Date(card.dueAt) <= now;
}

/** Returns true if the card has never been reviewed. */
export function isNew(card: Card): boolean {
  return card.repetitions === 0 && !card.lastReviewedAt;
}
