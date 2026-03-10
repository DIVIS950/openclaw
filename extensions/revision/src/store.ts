import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Card, DeckStats, RevisionStore } from "./types.js";
import { isDue, isNew } from "./sm2.js";

const DEFAULT_EASE_FACTOR = 2.5;

function defaultStorePath(): string {
  return path.join(os.homedir(), ".openclaw", "revision", "cards.json");
}

async function loadRaw(storePath: string): Promise<RevisionStore> {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as RevisionStore;
    if (parsed.version !== 1 || !Array.isArray(parsed.cards)) {
      return { version: 1, cards: [] };
    }
    return parsed;
  } catch {
    return { version: 1, cards: [] };
  }
}

async function save(store: RevisionStore, storePath: string): Promise<void> {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

function generateId(): string {
  return `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** High-level card store operations. */
export class RevisionCardStore {
  constructor(private readonly storePath: string = defaultStorePath()) {}

  async addCard(opts: {
    front: string;
    back: string;
    deck?: string;
    tags?: string[];
  }): Promise<Card> {
    const store = await loadRaw(this.storePath);
    const now = new Date().toISOString();
    const card: Card = {
      id: generateId(),
      deck: opts.deck ?? "default",
      front: opts.front.trim(),
      back: opts.back.trim(),
      repetitions: 0,
      interval: 1,
      easeFactor: DEFAULT_EASE_FACTOR,
      dueAt: now,
      createdAt: now,
      tags: opts.tags ?? [],
    };
    store.cards.push(card);
    await save(store, this.storePath);
    return card;
  }

  async getCards(opts: { deck?: string; tags?: string[] } = {}): Promise<Card[]> {
    const store = await loadRaw(this.storePath);
    return store.cards.filter((c) => {
      if (opts.deck && c.deck !== opts.deck) return false;
      if (opts.tags && opts.tags.length > 0) {
        if (!opts.tags.every((t) => c.tags.includes(t))) return false;
      }
      return true;
    });
  }

  async getDueCards(opts: { deck?: string; limit?: number } = {}): Promise<Card[]> {
    const cards = await this.getCards({ deck: opts.deck });
    const now = new Date();
    const due = cards.filter((c) => isDue(c, now));
    // New cards first, then by due date ascending
    due.sort((a, b) => {
      if (isNew(a) && !isNew(b)) return -1;
      if (!isNew(a) && isNew(b)) return 1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
    return opts.limit ? due.slice(0, opts.limit) : due;
  }

  async updateCard(id: string, updates: Partial<Card>): Promise<Card | null> {
    const store = await loadRaw(this.storePath);
    const idx = store.cards.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    store.cards[idx] = { ...store.cards[idx], ...updates } as Card;
    await save(store, this.storePath);
    return store.cards[idx] as Card;
  }

  async deleteCard(id: string): Promise<boolean> {
    const store = await loadRaw(this.storePath);
    const before = store.cards.length;
    store.cards = store.cards.filter((c) => c.id !== id);
    if (store.cards.length === before) return false;
    await save(store, this.storePath);
    return true;
  }

  async getDecks(): Promise<string[]> {
    const store = await loadRaw(this.storePath);
    return [...new Set(store.cards.map((c) => c.deck))].sort();
  }

  async getDeckStats(deck?: string): Promise<DeckStats[]> {
    const store = await loadRaw(this.storePath);
    const now = new Date();
    const decks = deck
      ? [deck]
      : [...new Set(store.cards.map((c) => c.deck))].sort();

    return decks.map((d) => {
      const cards = store.cards.filter((c) => c.deck === d);
      return {
        deck: d,
        total: cards.length,
        due: cards.filter((c) => isDue(c, now)).length,
        new: cards.filter((c) => isNew(c)).length,
        learned: cards.filter((c) => !isNew(c) && c.repetitions >= 2).length,
      };
    });
  }

  async importCards(
    cards: Array<{ front: string; back: string; deck?: string; tags?: string[] }>,
  ): Promise<number> {
    const store = await loadRaw(this.storePath);
    const now = new Date().toISOString();
    let count = 0;
    for (const c of cards) {
      store.cards.push({
        id: generateId(),
        deck: c.deck ?? "default",
        front: c.front.trim(),
        back: c.back.trim(),
        repetitions: 0,
        interval: 1,
        easeFactor: DEFAULT_EASE_FACTOR,
        dueAt: now,
        createdAt: now,
        tags: c.tags ?? [],
      });
      count++;
    }
    await save(store, this.storePath);
    return count;
  }
}
