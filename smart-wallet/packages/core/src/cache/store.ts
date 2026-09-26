/**
 * Generic in-memory TTL store.
 *
 * Expiry is checked on read (`check-on-get`): there are no timers, so nothing
 * leaks when a cache is abandoned, and a test can move time forward with a
 * clock instead of waiting. An entry that has expired is dropped the moment it
 * is read and counted as a miss, so `size` never lies about live data for
 * longer than one read.
 */

import type { CacheStats } from './types';

/** One stored value plus the instant it stops being fresh. */
interface CacheEntry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

export class CacheStore<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Reads `key`, or `undefined` when it is absent or expired.
   *
   * Both cases count as a miss; an expired entry is removed on the way out.
   */
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return entry.value;
  }

  /**
   * Stores `value` under `key` for `ttlMs` milliseconds.
   *
   * A non-positive or non-finite TTL stores an entry that is already expired,
   * which is the safe reading of "do not cache this".
   */
  set(key: K, value: V, ttlMs: number): void {
    const ttl = Number.isFinite(ttlMs) ? Math.max(0, ttlMs) : 0;
    this.entries.set(key, { value, expiresAt: this.now() + ttl });
  }

  /** Drops `key`. Returns whether anything was removed. */
  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  /** Drops every entry and leaves the counters alone. */
  clear(): void {
    this.entries.clear();
  }

  /** Hits, misses and the number of stored entries. */
  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses, size: this.entries.size };
  }
}
