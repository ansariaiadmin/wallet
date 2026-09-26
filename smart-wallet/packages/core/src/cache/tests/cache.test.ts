import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CacheStore,
  CachedOracle,
  CachedRiskAssessor,
  PRICE_CACHE_TTL_MS,
  RISK_CACHE_TTL_MS,
  clearPriceCache,
  clearRiskCache,
  priceCacheStats,
  riskCacheStats,
} from '../index';
import { PriceOracle, RiskChecker, type PriceProvider, type RiskProvider } from '../../index';
import type { RiskAssessment, TokenPrice } from '../../index';

/** Clock the tests move by hand, so a TTL can expire without waiting. */
let clock = 1_000_000;
const now = (): number => clock;

afterEach(() => {
  clock = 1_000_000;
  clearPriceCache();
  clearRiskCache();
  vi.restoreAllMocks();
});

/** A price provider that counts how often it was asked. */
function countingPriceProvider(prices: Record<string, number>): PriceProvider & {
  readonly calls: number;
} {
  const provider = {
    calls: 0,
    name: 'counting',
    async fetchPrices(req: { symbols: readonly string[] }) {
      provider.calls += 1;
      const out = new Map<string, TokenPrice>();
      for (const symbol of req.symbols) {
        const usdPrice = prices[symbol];
        if (usdPrice === undefined) {
          continue;
        }
        out.set(symbol, {
          symbol,
          usdPrice,
          change24hBps: 100,
          confidence: 'high',
          updatedAt: 1,
          source: provider.name,
        });
      }
      return out;
    },
  };
  return provider;
}

/** A screening provider that counts how often it was asked. */
function countingRiskProvider(): RiskProvider & { readonly calls: number } {
  const provider = {
    calls: 0,
    name: 'counting-risk',
    async checkAddress() {
      provider.calls += 1;
      return [];
    },
    async checkToken() {
      provider.calls += 1;
      return [];
    },
  };
  return provider;
}

describe('CacheStore', () => {
  it('returns a value that was set', () => {
    const store = new CacheStore<string, number>(now);

    store.set('a', 1, 1_000);

    expect(store.get('a')).toBe(1);
  });

  it('returns undefined for a missing key', () => {
    const store = new CacheStore<string, number>(now);

    expect(store.get('missing')).toBeUndefined();
  });

  it('returns undefined once the entry has expired', () => {
    const store = new CacheStore<string, number>(now);
    store.set('a', 1, 1_000);

    clock += 1_000;

    expect(store.get('a')).toBeUndefined();
  });

  it('keeps serving an entry until the TTL has passed', () => {
    const store = new CacheStore<string, number>(now);
    store.set('a', 1, 1_000);

    clock += 999;

    expect(store.get('a')).toBe(1);
  });

  it('drops one entry on delete', () => {
    const store = new CacheStore<string, number>(now);
    store.set('a', 1, 1_000);
    store.set('b', 2, 1_000);

    expect(store.delete('a')).toBe(true);
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBe(2);
  });

  it('reports false when deleting an unknown key', () => {
    expect(new CacheStore<string, number>(now).delete('nope')).toBe(false);
  });

  it('drops every entry on clear', () => {
    const store = new CacheStore<string, number>(now);
    store.set('a', 1, 1_000);
    store.set('b', 2, 1_000);

    store.clear();

    expect(store.stats().size).toBe(0);
    expect(store.get('a')).toBeUndefined();
  });

  it('counts hits and misses in stats', () => {
    const store = new CacheStore<string, number>(now);
    store.set('a', 1, 1_000);

    store.get('a');
    store.get('a');
    store.get('missing');

    expect(store.stats()).toEqual({ hits: 2, misses: 1, size: 1 });
  });

  it('counts an expired read as a miss and forgets the entry', () => {
    const store = new CacheStore<string, number>(now);
    store.set('a', 1, 100);

    clock += 100;
    store.get('a');

    expect(store.stats()).toEqual({ hits: 0, misses: 1, size: 0 });
  });

  it('keeps two keys independent when one expires', () => {
    const store = new CacheStore<string, string>(now);
    store.set('short', 'x', 500);
    store.set('long', 'y', 5_000);

    clock += 1_000;

    expect(store.get('short')).toBeUndefined();
    expect(store.get('long')).toBe('y');
  });

  it('treats a non-positive TTL as already expired', () => {
    const store = new CacheStore<string, number>(now);

    store.set('a', 1, 0);

    expect(store.get('a')).toBeUndefined();
  });

  it('returns the stored object, not a copy', () => {
    const store = new CacheStore<string, { n: number }>(now);
    const value = { n: 1 };
    store.set('a', value, 1_000);

    expect(store.get('a')).toBe(value);
  });
});

describe('CachedOracle', () => {
  it('queries the provider once for two consecutive lookups', async () => {
    const provider = countingPriceProvider({ ETH: 3200 });
    const oracle = new CachedOracle(new PriceOracle([provider]), { store: new CacheStore(now) });

    const first = await oracle.fetchPrice('ETH');
    const second = await oracle.fetchPrice('ETH');

    expect(provider.calls).toBe(1);
    expect(second).toBe(first);
  });

  it('returns the same object the oracle produced', async () => {
    const provider = countingPriceProvider({ ETH: 3200 });
    const oracle = new CachedOracle(new PriceOracle([provider]), { store: new CacheStore(now) });

    const price = await oracle.fetchPrice('ETH');

    expect(price.usdPrice).toBe(3200);
    expect(price.symbol).toBe('ETH');
  });

  it('queries the provider again once the TTL has passed', async () => {
    const provider = countingPriceProvider({ ETH: 3200 });
    const oracle = new CachedOracle(new PriceOracle([provider]), {
      ttlMs: PRICE_CACHE_TTL_MS,
      store: new CacheStore(now),
    });

    await oracle.fetchPrice('ETH');
    clock += PRICE_CACHE_TTL_MS;
    await oracle.fetchPrice('ETH');

    expect(provider.calls).toBe(2);
  });

  it('keeps separate entries per symbol and currency', async () => {
    const provider = countingPriceProvider({ ETH: 3200, BTC: 60_000 });
    const oracle = new CachedOracle(new PriceOracle([provider]), { store: new CacheStore(now) });

    await oracle.fetchPrice('ETH');
    await oracle.fetchPrice('ETH', 'EUR');
    await oracle.fetchPrice('BTC');

    expect(provider.calls).toBe(3);
    expect(oracle.cacheStats().size).toBe(3);
  });

  it('does not cache a failure', async () => {
    const provider = countingPriceProvider({ ETH: 3200 });
    const oracle = new CachedOracle(new PriceOracle([provider]), { store: new CacheStore(now) });

    await expect(oracle.fetchPrice('UNKNOWN_XYZ')).rejects.toMatchObject({
      code: 'SYMBOL_NOT_FOUND',
    });
    await expect(oracle.fetchPrice('UNKNOWN_XYZ')).rejects.toMatchObject({
      code: 'SYMBOL_NOT_FOUND',
    });

    expect(provider.calls).toBe(2);
    expect(oracle.cacheStats().size).toBe(0);
  });

  it('reports hits, misses and size', async () => {
    const provider = countingPriceProvider({ ETH: 3200 });
    const oracle = new CachedOracle(new PriceOracle([provider]), { store: new CacheStore(now) });

    await oracle.fetchPrice('ETH');
    await oracle.fetchPrice('ETH');
    // The unknown symbol is a miss too: the cache could not answer it, and
    // nothing was stored because the failure is never cached.
    await expect(oracle.fetchPrice('NOPE')).rejects.toBeDefined();

    expect(oracle.cacheStats()).toEqual({ hits: 1, misses: 2, size: 1 });
  });

  it('clears its cache, so the next lookup misses', async () => {
    const provider = countingPriceProvider({ ETH: 3200 });
    const oracle = new CachedOracle(new PriceOracle([provider]), { store: new CacheStore(now) });
    await oracle.fetchPrice('ETH');

    oracle.clearCache();
    await oracle.fetchPrice('ETH');

    expect(provider.calls).toBe(2);
    expect(oracle.cacheStats().size).toBe(1);
  });

  it('shares the process-wide store and its module-level helpers', async () => {
    const provider = countingPriceProvider({ ETH: 3200 });
    const oracle = new CachedOracle(new PriceOracle([provider]));

    await oracle.fetchPrice('ETH');
    await oracle.fetchPrice('ETH');

    expect(priceCacheStats()).toEqual({ hits: 1, misses: 1, size: 1 });

    clearPriceCache();

    expect(priceCacheStats().size).toBe(0);
    expect(oracle.cacheStats().size).toBe(0);
  });

  it('counts the first read of every symbol as a miss', async () => {
    const provider = countingPriceProvider({ ETH: 3200, BTC: 60_000 });
    const oracle = new CachedOracle(new PriceOracle([provider]), { store: new CacheStore(now) });

    await oracle.fetchPrice('ETH');
    await oracle.fetchPrice('BTC');

    expect(oracle.cacheStats()).toEqual({ hits: 0, misses: 2, size: 2 });
  });
});

describe('CachedRiskAssessor', () => {
  it('queries the providers once for two consecutive screens', async () => {
    const provider = countingRiskProvider();
    const assessor = new CachedRiskAssessor(new RiskChecker([provider]), {
      store: new CacheStore(now),
    });

    const first = await assessor.assessAddress({ address: '0xabc' });
    const second = await assessor.assessAddress({ address: '0xabc' });

    expect(provider.calls).toBe(1);
    expect(second).toBe(first);
  });

  it('queries the providers again once the TTL has passed', async () => {
    const provider = countingRiskProvider();
    const assessor = new CachedRiskAssessor(new RiskChecker([provider]), {
      ttlMs: RISK_CACHE_TTL_MS,
      store: new CacheStore(now),
    });

    await assessor.assessAddress({ address: '0xabc' });
    clock += RISK_CACHE_TTL_MS;
    await assessor.assessAddress({ address: '0xabc' });

    expect(provider.calls).toBe(2);
  });

  it('tracks two addresses independently', async () => {
    const provider = countingRiskProvider();
    const assessor = new CachedRiskAssessor(new RiskChecker([provider]), {
      store: new CacheStore(now),
    });

    await assessor.assessAddress({ address: '0xaaa' });
    await assessor.assessAddress({ address: '0xaaa' });
    await assessor.assessAddress({ address: '0xbbb' });

    expect(provider.calls).toBe(2);
    expect(assessor.cacheStats()).toEqual({ hits: 1, misses: 2, size: 2 });
  });

  it('separates the same address on different networks', async () => {
    const provider = countingRiskProvider();
    const assessor = new CachedRiskAssessor(new RiskChecker([provider]), {
      store: new CacheStore(now),
    });

    await assessor.assessAddress({ address: '0xabc', chain: 'ethereum' });
    await assessor.assessAddress({ address: '0xabc', chain: 'bsc' });

    expect(provider.calls).toBe(2);
    expect(assessor.cacheStats().size).toBe(2);
  });

  it('caches token screens under their own key', async () => {
    const provider = countingRiskProvider();
    const assessor = new CachedRiskAssessor(new RiskChecker([provider]), {
      store: new CacheStore(now),
    });

    await assessor.assessToken({ symbol: 'USDT' });
    await assessor.assessToken({ symbol: 'USDT' });

    expect(provider.calls).toBe(1);
    expect(assessor.cacheStats()).toEqual({ hits: 1, misses: 1, size: 1 });
  });

  it('does not cache a failure', async () => {
    const provider = countingRiskProvider();
    const assessor = new CachedRiskAssessor(new RiskChecker([provider]), {
      store: new CacheStore(now),
    });

    await expect(assessor.assessAddress({ address: '   ' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(assessor.assessAddress({ address: '   ' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });

    expect(assessor.cacheStats().size).toBe(0);
  });

  it('clears its cache, so the next screen misses', async () => {
    const provider = countingRiskProvider();
    const assessor = new CachedRiskAssessor(new RiskChecker([provider]), {
      store: new CacheStore(now),
    });
    await assessor.assessAddress({ address: '0xabc' });

    assessor.clearCache();
    await assessor.assessAddress({ address: '0xabc' });

    expect(provider.calls).toBe(2);
  });

  it('shares the process-wide store and its module-level helpers', async () => {
    const provider = countingRiskProvider();
    const assessor = new CachedRiskAssessor(new RiskChecker([provider]));

    await assessor.assessAddress({ address: '0xabc' });
    await assessor.assessAddress({ address: '0xabc' });

    expect(riskCacheStats()).toEqual({ hits: 1, misses: 1, size: 1 });

    clearRiskCache();

    expect(riskCacheStats().size).toBe(0);
  });

  it('returns a full assessment object', async () => {
    const provider = countingRiskProvider();
    const assessor = new CachedRiskAssessor(new RiskChecker([provider]), {
      store: new CacheStore(now),
    });

    const assessment: RiskAssessment = await assessor.assessAddress({ address: '0xabc' });

    expect(assessment.overallRisk).toBe('none');
    expect(assessment.flags).toEqual([]);
    expect(typeof assessment.assessedAt).toBe('number');
  });
});
