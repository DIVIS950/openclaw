// In-memory cache with TTL — used server-side to avoid rate-limit blowouts

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    // Evict oldest if at max size
    if (this.store.size >= this.maxSize) {
      const entries = Array.from(this.store.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt
      );
      const oldest = entries[0];
      if (oldest) this.store.delete(oldest[0]);
    }

    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
    });
  }

  get<T>(key: string): { data: T; age: number } | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return { data: entry.data, age: Date.now() - entry.createdAt };
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

// Singleton cache used across the app
export const cache = new MemoryCache(500);

// TTL constants (milliseconds)
export const TTL = {
  QUOTE: 30_000,        // 30s — real-time quotes
  CANDLES: 60_000,      // 1m — OHLCV data
  PROFILE: 3_600_000,   // 1h — company info rarely changes
  NEWS: 300_000,        // 5m — news feed
  AI_SIGNAL: 600_000,   // 10m — AI analysis
  SEARCH: 600_000,      // 10m — search results
  MARKET_DATA: 30_000,  // 30s — index data
} as const;
