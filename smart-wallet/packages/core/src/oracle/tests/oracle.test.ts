import { describe, expect, it } from 'vitest';
import {
  median,
  mockBinanceProvider,
  mockCoinGeckoProvider,
  mockKrakenProvider,
  OracleError,
  PriceOracle,
  type PriceProvider,
  type TokenPrice,
} from '../index';
import { createMockProvider } from '../providers/mock';

/** All three deterministic mock providers, in a fixed order. */
function mockOracle(): PriceOracle {
  return new PriceOracle([mockCoinGeckoProvider, mockBinanceProvider, mockKrakenProvider]);
}

/** A provider that answers with a static table. */
function staticProvider(
  name: string,
  entries: Readonly<Record<string, { usdPrice: number; change24hBps: number }>>,
): PriceProvider {
  return createMockProvider(name, entries);
}

/** A provider that always fails, like an aggregator with an outage. */
function brokenProvider(name: string, message: string): PriceProvider {
  return {
    name,
    async fetchPrices() {
      throw new Error(message);
    },
  };
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

describe('median', () => {
  it('returns the exact middle element for an odd count', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([3210, 3200, 3195])).toBe(3200);
  });

  it('averages the two middle elements for an even count', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([420, 419.5])).toBe(419.75);
  });

  it('returns the element itself for a single value', () => {
    expect(median([7])).toBe(7);
    expect(median([0.118])).toBe(0.118);
  });

  it('throws on an empty array', () => {
    expect(() => median([])).toThrow();
  });

  it('works with negative numbers', () => {
    expect(median([-5, -1, -3])).toBe(-3);
    expect(median([-1, -2, -3, -4])).toBe(-2.5);
    expect(median([10, -10, 0])).toBe(0);
  });

  it('does not mutate its input', () => {
    const values = [5, 1, 4];
    median(values);
    expect(values).toEqual([5, 1, 4]);
  });
});

describe('OracleError', () => {
  it('carries its code and name', () => {
    const error = new OracleError('NO_PROVIDER', 'no providers', { configured: 0 });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OracleError);
    expect(error.code).toBe('NO_PROVIDER');
    expect(error.name).toBe('OracleError');
    expect(error.message).toBe('no providers');
    expect(error.cause).toEqual({ configured: 0 });
  });

  it('accepts every documented code', () => {
    const codes = ['NO_PROVIDER', 'ALL_FAILED', 'SYMBOL_NOT_FOUND'] as const;

    for (const code of codes) {
      expect(new OracleError(code, code).code).toBe(code);
    }
  });
});

describe('mock providers', () => {
  it('CoinGecko reports its own base prices', async () => {
    const prices = await mockCoinGeckoProvider.fetchPrices({ symbols: ['ETH', 'BTC', 'SOL'] });

    expect(prices.get('ETH')?.usdPrice).toBe(3200);
    expect(prices.get('BTC')?.usdPrice).toBe(62000);
    expect(prices.get('SOL')?.usdPrice).toBe(145);
    expect(prices.get('ETH')?.confidence).toBe('high');
    expect(prices.get('ETH')?.source).toBe('mock-coingecko');
  });

  it('Binance and Kraken differ from CoinGecko so medians are meaningful', async () => {
    const binance = await mockBinanceProvider.fetchPrices({ symbols: ['ETH'] });
    const kraken = await mockKrakenProvider.fetchPrices({ symbols: ['ETH'] });

    expect(binance.get('ETH')?.usdPrice).toBe(3195);
    expect(kraken.get('ETH')?.usdPrice).toBe(3210);
    expect(binance.get('ETH')?.change24hBps).toBe(145);
    expect(kraken.get('ETH')?.change24hBps).toBe(155);
  });

  it('omits symbols outside the provider list instead of throwing', async () => {
    const coingecko = await mockCoinGeckoProvider.fetchPrices({ symbols: ['DOGE', 'ETH'] });
    const binance = await mockBinanceProvider.fetchPrices({ symbols: ['MATIC', 'ETH'] });
    const kraken = await mockKrakenProvider.fetchPrices({ symbols: ['MATIC', 'BNB', 'ETH'] });

    expect([...coingecko.keys()]).toEqual(['ETH']);
    expect([...binance.keys()]).toEqual(['ETH']);
    expect([...kraken.keys()]).toEqual(['ETH']);
  });

  it('upper-cases and trims the requested symbols', async () => {
    const prices = await mockCoinGeckoProvider.fetchPrices({ symbols: [' eth ', 'btc'] });

    expect([...prices.keys()]).toEqual(['ETH', 'BTC']);
    expect(prices.get('ETH')?.symbol).toBe('ETH');
  });

  it('stamps updatedAt with the current unix second', async () => {
    const before = nowSeconds();
    const prices = await mockCoinGeckoProvider.fetchPrices({ symbols: ['ETH'] });

    expect(prices.get('ETH')?.updatedAt).toBeGreaterThanOrEqual(before);
    expect(prices.get('ETH')?.updatedAt).toBeLessThanOrEqual(nowSeconds());
  });

  it('returns identical prices on repeated calls', async () => {
    const first = await mockCoinGeckoProvider.fetchPrices({ symbols: ['TRX'] });
    const second = await mockCoinGeckoProvider.fetchPrices({ symbols: ['TRX'] });

    expect(first.get('TRX')?.usdPrice).toBe(second.get('TRX')?.usdPrice);
    expect(first.get('TRX')?.change24hBps).toBe(second.get('TRX')?.change24hBps);
  });
});

describe('PriceOracle construction', () => {
  it('throws NO_PROVIDER when constructed with an empty array', async () => {
    const oracle = new PriceOracle([]);
    const error = await oracle.fetchPrices({ symbols: ['ETH'] }).catch((c: unknown) => c);

    expect(error).toBeInstanceOf(OracleError);
    expect((error as OracleError).code).toBe('NO_PROVIDER');
    expect((error as OracleError).message).toContain('provider');
  });

  it('also throws NO_PROVIDER for a single-symbol fetch', async () => {
    const oracle = new PriceOracle([]);
    const error = await oracle.fetchPrice('ETH').catch((c: unknown) => c);

    expect((error as OracleError).code).toBe('NO_PROVIDER');
  });
});

describe('PriceOracle.fetchPrices', () => {
  it('returns a TokenPrice with the documented shape', async () => {
    const before = nowSeconds();
    const result = await mockOracle().fetchPrices({ symbols: ['ETH'] });
    const price = result.prices.get('ETH');

    expect(price).toBeDefined();
    expect(price).toMatchObject({
      symbol: 'ETH',
      usdPrice: expect.any(Number),
      change24hBps: expect.any(Number),
      confidence: expect.any(String),
      source: expect.any(String),
      updatedAt: expect.any(Number),
    });
    expect(result.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(result.fetchedAt).toBeLessThanOrEqual(nowSeconds());
  });

  it('uses the median of the three provider prices', async () => {
    const result = await mockOracle().fetchPrices({ symbols: ['ETH'] });

    // 3195 (binance), 3200 (coingecko), 3210 (kraken)
    expect(result.prices.get('ETH')?.usdPrice).toBe(3200);
  });

  it('uses the median of the three provider changes', async () => {
    const result = await mockOracle().fetchPrices({ symbols: ['ETH'] });

    // 145 (binance), 150 (coingecko), 155 (kraken)
    expect(result.prices.get('ETH')?.change24hBps).toBe(150);
  });

  it('averages the two middle values when only two providers answer', async () => {
    const oracle = new PriceOracle([mockCoinGeckoProvider, mockBinanceProvider]);

    const result = await oracle.fetchPrices({ symbols: ['BNB'] });

    // 419.5 (binance) and 420 (coingecko)
    expect(result.prices.get('BNB')?.usdPrice).toBe(419.75);
    expect(result.prices.get('BNB')?.change24hBps).toBe(257.5);
    expect(result.prices.get('BNB')?.confidence).toBe('high');
  });

  it('reports high confidence when every provider agrees', async () => {
    const result = await mockOracle().fetchPrices({ symbols: ['ETH'] });

    expect(result.prices.get('ETH')?.confidence).toBe('high');
  });

  it('joins the contributing provider names into source', async () => {
    const result = await mockOracle().fetchPrices({ symbols: ['ETH'] });

    expect(result.prices.get('ETH')?.source).toBe('mock-coingecko,mock-binance,mock-kraken');
  });

  it('deduplicates symbols before querying the providers', async () => {
    const requests: string[][] = [];
    const recorder: PriceProvider = {
      name: 'recorder',
      async fetchPrices(req) {
        requests.push([...req.symbols]);
        return new Map<string, TokenPrice>([
          [
            'ETH',
            {
              symbol: 'ETH',
              usdPrice: 1,
              change24hBps: 0,
              confidence: 'high',
              updatedAt: 0,
              source: 'recorder',
            },
          ],
        ]);
      },
    };
    const oracle = new PriceOracle([recorder]);

    const result = await oracle.fetchPrices({ symbols: ['ETH', 'eth', ' Eth '] });

    expect(requests).toEqual([['ETH']]);
    expect([...result.prices.keys()]).toEqual(['ETH']);
  });

  it('keys the result map by upper-cased symbol', async () => {
    const result = await mockOracle().fetchPrices({ symbols: ['eth', 'BtC', 'sol'] });

    expect([...result.prices.keys()]).toEqual(['ETH', 'BTC', 'SOL']);
    expect(result.prices.get('eth')).toBeUndefined();
  });

  it('still returns results when one provider fails', async () => {
    const oracle = new PriceOracle([
      mockCoinGeckoProvider,
      brokenProvider('broken', 'upstream 503'),
      mockKrakenProvider,
    ]);

    const result = await oracle.fetchPrices({ symbols: ['ETH'] });

    expect(result.prices.get('ETH')?.usdPrice).toBe(3205);
    expect(result.prices.get('ETH')?.change24hBps).toBe(152.5);
    expect(result.prices.get('ETH')?.source).toBe('mock-coingecko,mock-kraken');
    expect(result.prices.get('ETH')?.confidence).toBe('high');
  });

  it('throws ALL_FAILED when every provider throws', async () => {
    const oracle = new PriceOracle([
      brokenProvider('one', 'rate limited'),
      brokenProvider('two', 'timeout'),
    ]);

    const error = await oracle.fetchPrices({ symbols: ['ETH'] }).catch((c: unknown) => c);

    expect(error).toBeInstanceOf(OracleError);
    expect((error as OracleError).code).toBe('ALL_FAILED');
    expect((error as OracleError).cause).toEqual(['one', 'two']);
  });

  it('throws SYMBOL_NOT_FOUND when no provider knows the symbol', async () => {
    const oracle = mockOracle();
    const error = await oracle.fetchPrices({ symbols: ['DOGE'] }).catch((c: unknown) => c);

    expect(error).toBeInstanceOf(OracleError);
    expect((error as OracleError).code).toBe('SYMBOL_NOT_FOUND');
    expect((error as OracleError).message).toContain('DOGE');
  });

  it('throws SYMBOL_NOT_FOUND naming only the missing symbol', async () => {
    const oracle = mockOracle();
    const error = await oracle.fetchPrices({ symbols: ['ETH', 'DOGE'] }).catch((c: unknown) => c);

    expect((error as OracleError).code).toBe('SYMBOL_NOT_FOUND');
    expect((error as OracleError).message).toContain('DOGE');
    expect((error as OracleError).message).not.toContain('ETH');
  });

  it('returns an empty result for an empty symbol list', async () => {
    const result = await mockOracle().fetchPrices({ symbols: [] });

    expect(result.prices.size).toBe(0);
  });

  it('keeps no state between calls', async () => {
    const oracle = mockOracle();

    const first = await oracle.fetchPrices({ symbols: ['ETH'] });
    const second = await oracle.fetchPrices({ symbols: ['ETH'] });

    expect(second.prices.get('ETH')?.usdPrice).toBe(first.prices.get('ETH')?.usdPrice);
    expect(second.prices.get('ETH')?.source).toBe(first.prices.get('ETH')?.source);
  });

  it('reports medium confidence when only one provider covers the symbol', async () => {
    // MATIC is listed by CoinGecko only: Binance and Kraken omit it.
    const result = await mockOracle().fetchPrices({ symbols: ['MATIC'] });

    expect(result.prices.get('MATIC')?.confidence).toBe('medium');
    expect(result.prices.get('MATIC')?.source).toBe('mock-coingecko');
    expect(result.prices.get('MATIC')?.usdPrice).toBe(0.88);
  });

  it('reports medium confidence when the other providers omit the symbol', async () => {
    const oracle = new PriceOracle([
      staticProvider('only', { DOGE: { usdPrice: 0.42, change24hBps: 10 } }),
      staticProvider('empty-a', {}),
      staticProvider('empty-b', {}),
    ]);

    const result = await oracle.fetchPrices({ symbols: ['DOGE'] });

    expect(result.prices.get('DOGE')?.confidence).toBe('medium');
    expect(result.prices.get('DOGE')?.source).toBe('only');
    expect(result.prices.get('DOGE')?.usdPrice).toBe(0.42);
  });
});

describe('PriceOracle.fetchPrice', () => {
  it('returns a TokenPrice for a single symbol', async () => {
    const price = await mockOracle().fetchPrice('BTC');

    expect(price.symbol).toBe('BTC');
    expect(price.usdPrice).toBe(62000);
    expect(price.change24hBps).toBe(-220);
    expect(price.confidence).toBe('high');
    expect(price.source).toBe('mock-coingecko,mock-binance,mock-kraken');
  });

  it('accepts a lower-case symbol', async () => {
    const price = await mockOracle().fetchPrice('sol');

    expect(price.symbol).toBe('SOL');
    expect(price.usdPrice).toBe(145);
  });

  it('throws SYMBOL_NOT_FOUND for an unknown symbol', async () => {
    const oracle = mockOracle();
    const error = await oracle.fetchPrice('DOGE').catch((c: unknown) => c);

    expect(error).toBeInstanceOf(OracleError);
    expect((error as OracleError).code).toBe('SYMBOL_NOT_FOUND');
  });
});

describe('PriceOracle multi-symbol fetches', () => {
  it('fetches several symbols at once', async () => {
    const result = await mockOracle().fetchPrices({ symbols: ['ETH', 'BTC', 'SOL'] });

    expect([...result.prices.keys()]).toEqual(['ETH', 'BTC', 'SOL']);
    expect(result.prices.get('ETH')?.usdPrice).toBe(3200);
    expect(result.prices.get('BTC')?.usdPrice).toBe(62000);
    expect(result.prices.get('SOL')?.usdPrice).toBe(145);
  });

  it('prices the stablecoins around one dollar', async () => {
    const result = await mockOracle().fetchPrices({ symbols: ['USDC', 'USDT'] });

    expect(result.prices.get('USDC')?.usdPrice).toBeCloseTo(1, 2);
    expect(result.prices.get('USDT')?.usdPrice).toBeCloseTo(1, 2);
    expect(result.prices.get('USDC')?.confidence).toBe('high');
  });

  it('prices TRX in fractions of a dollar', async () => {
    const result = await mockOracle().fetchPrices({ symbols: ['TRX'] });

    expect(result.prices.get('TRX')?.usdPrice).toBe(0.118);
    expect(result.prices.get('TRX')?.change24hBps).toBe(12);
  });
});
