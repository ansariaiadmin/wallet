/**
 * Price lookups with a short-lived cache in front of the P7 oracle.
 *
 * The oracle is deterministic and free, but every call fans out to every
 * provider, and a price is only interesting for a few seconds. The wrapper
 * keeps the answer for {@link PRICE_CACHE_TTL_MS} per `symbol:currency`, so a
 * burst of requests for the same symbol costs one aggregation.
 *
 * Only successful lookups are cached: a failure says nothing about the price,
 * and caching it would keep the failure alive after the providers recover.
 */

import type { PriceOracle, TokenPrice } from '../oracle/index.js';
import type { CacheOptions, CacheStats } from './types';
import { CacheStore } from './store';

/** How long a price stays fresh. Prices move fast, so this is short. */
export const PRICE_CACHE_TTL_MS = 30_000;

/** What a {@link CachedOracle} accepts on top of {@link CacheOptions}. */
export interface CachedOracleOptions extends CacheOptions {
  /** Store to use; defaults to a fresh one per instance. */
  readonly store?: CacheStore<string, TokenPrice>;
}

export class CachedOracle {
  private readonly oracle: PriceOracle;
  private readonly ttlMs: number;
  private readonly store: CacheStore<string, TokenPrice>;

  constructor(oracle: PriceOracle, options: CachedOracleOptions = {}) {
    this.oracle = oracle;
    this.ttlMs = options.ttlMs ?? PRICE_CACHE_TTL_MS;
    this.store = options.store ?? new CacheStore<string, TokenPrice>();
  }

  /**
   * Aggregated price for `symbol`, from the cache when it is still fresh.
   *
   * @param currency quote currency; the mock providers are USD-only today, but
   *   the key is namespaced so a future currency cannot collide.
   * @throws whatever the oracle throws — failures are never cached.
   */
  async fetchPrice(symbol: string, currency = 'USD'): Promise<TokenPrice> {
    const key = priceKey(symbol, currency);
    const cached = this.store.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const price = await this.oracle.fetchPrice(symbol);
    this.store.set(key, price, this.ttlMs);
    return price;
  }

  /** Drops every cached price. */
  clearCache(): void {
    this.store.clear();
  }

  /** Hits, misses and the number of cached prices. */
  cacheStats(): CacheStats {
    return this.store.stats();
  }
}

/** Cache key for one symbol in one currency. */
export function priceKey(symbol: string, currency = 'USD'): string {
  const normalized = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
  return `${normalized}:${currency.trim().toUpperCase()}`;
}
