/**
 * Javora — response caching for read-heavy public endpoints.
 *
 * A tiny in-process TTL memoizer, not a cache server. Two things this project
 * already established made a shared cache (Redis, etc.) unnecessary here: the
 * API is documented as a single-instance deployment (see the rate limiter's
 * own comment in server.ts), and the underlying queries already measured at
 * 0.7–4.3ms against the real database (see the performance report this file
 * was added for) — the case for caching is reducing repeated DB round-trips
 * under concurrent read load, not fixing slow queries, because there are none.
 *
 * THE CENTRAL CONSTRAINT, FROM THE TASK THAT ADDED THIS: current government
 * data must never be cached as aggressively as historical/structural data.
 * `/api/government/current` answers "who currently holds office" — the one
 * fact on this site where staleness has the highest cost, since a reshuffle
 * that already happened would otherwise still show the outgoing minister.
 * `/api/facets` answers "how many people are in each party/district/role" —
 * useful, but nobody makes a decision based on a facet count being 30 seconds
 * old. The two default TTLs below are chosen to reflect exactly that
 * difference, and a test (cache.test.ts) enforces the SHORTER-THAN
 * relationship between them as a standing invariant, not just a comment that
 * can drift.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private entry: CacheEntry<T> | null = null;
  /** The in-flight recomputation, if one is already running. */
  private pending: Promise<T> | null = null;
  private readonly ttlMs: number;

  // An explicit field, not a constructor parameter property: Node runs this
  // TypeScript in strip-only mode, which cannot emit the assignment a
  // parameter property implies (the same fix store.ts's own header comment
  // already documents — confirmed again here by actually running this file
  // with `node`, not just vitest, which uses a different transform and does
  // not catch this).
  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  /**
   * Returns the cached value if still fresh; otherwise computes, caches, and
   * returns a new one.
   *
   * Concurrent callers during a miss share ONE in-flight computation rather
   * than each starting their own — without `pending`, ten simultaneous
   * requests arriving the instant the cache expires would each see "no
   * fresh entry" and each run their own query, which defeats the point of
   * caching for exactly the burst-of-concurrent-reads case it exists for.
   */
  async get(compute: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (this.entry && this.entry.expiresAt > now) return this.entry.value;
    if (this.pending) return this.pending;

    this.pending = compute();
    try {
      const value = await this.pending;
      this.entry = { value, expiresAt: Date.now() + this.ttlMs };
      return value;
    } finally {
      this.pending = null;
    }
  }

  /** Discards the cached value, forcing the next `get` to recompute. Used by tests. */
  invalidate(): void {
    this.entry = null;
    this.pending = null;
  }
}
