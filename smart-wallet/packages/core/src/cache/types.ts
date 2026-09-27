/**
 * Types shared by the in-memory TTL caches.
 */

/** Hit/miss counters plus how many entries are currently held. */
export interface CacheStats {
  /** Reads answered from the cache. */
  readonly hits: number;
  /** Reads the cache could not answer, including expired entries. */
  readonly misses: number;
  /** Entries currently stored, expired ones included until they are read. */
  readonly size: number;
}

/** Knobs every cached wrapper accepts. */
export interface CacheOptions {
  /** How long an entry stays fresh, in ms. Defaults per wrapper. */
  readonly ttlMs?: number;
  /** Clock in ms, injected so tests can fast-forward through a TTL. */
  readonly now?: () => number;
}
