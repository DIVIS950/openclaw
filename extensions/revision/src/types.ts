/** A single flashcard with front/back content and SM-2 scheduling metadata. */
export interface Card {
  id: string;
  deck: string;
  front: string;
  back: string;
  /** SM-2: number of repetitions successfully completed */
  repetitions: number;
  /** SM-2: inter-repetition interval in days */
  interval: number;
  /** SM-2: easiness factor (≥1.3) */
  easeFactor: number;
  /** ISO timestamp of when this card is next due */
  dueAt: string;
  /** ISO timestamp of card creation */
  createdAt: string;
  /** ISO timestamp of last review */
  lastReviewedAt?: string;
  /** Tags for filtering */
  tags: string[];
}

/** Quality rating for an SM-2 review (0–5 scale) */
export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

/** Summary stats for a deck */
export interface DeckStats {
  deck: string;
  total: number;
  due: number;
  new: number;
  learned: number;
}

/** The root data structure persisted to disk */
export interface RevisionStore {
  version: 1;
  cards: Card[];
}
