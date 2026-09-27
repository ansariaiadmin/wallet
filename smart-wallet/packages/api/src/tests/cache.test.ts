import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  CacheStore,
  CachedOracle,
  CachedRiskAssessor,
  PriceOracle,
  RiskChecker,
  type PriceProvider,
  type RiskProvider,
} from '@wallet/core';
import { withErrorHandler } from '../app';
import { SmartWallet } from '@wallet/sdk';
import { rateLimitMiddleware, RateLimiter } from '../rate-limit';
import { cacheRoutes } from '../routes/cache';
import { priceRoutes } from '../routes/price';
import { riskRoutes } from '../routes/risk';

/** Clock the tests move by hand, so a window can close without waiting. */
let clock = 1_800_000_000_000;
const now = (): number => clock;

/** A price provider that counts how often it was asked. */
function countingPriceProvider(prices: Record<string, number>): PriceProvider & { calls: number } {
  const provider = {
    calls: 0,
    name: 'counting',
    async fetchPrices(req: { symbols: readonly string[] }) {
      provider.calls += 1;
      const out = new Map();
      for (const symbol of req.symbols) {
        const usdPrice = prices[symbol];
        if (usdPrice === undefined) {
          continue;
        }
        out.set(symbol, {
          symbol,
          usdPrice,
          change24hBps: 150,
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
function countingRiskProvider(): RiskProvider & { calls: number } {
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

/** The app under test: cached routes, cache routes and a rate limiter. */
function buildApp(options: { limiter?: RateLimiter } = {}): {
  app: Hono;
  price: CachedOracle;
  risk: CachedRiskAssessor;
  priceProvider: ReturnType<typeof countingPriceProvider>;
  riskProvider: ReturnType<typeof countingRiskProvider>;
  limiter: RateLimiter;
} {
  const priceProvider = countingPriceProvider({ ETH: 3200, BTC: 60_000 });
  const riskProvider = countingRiskProvider();
  // A store per app: the default one is process-wide and would leak entries
  // (and hit counts) between these tests.
  const price = new CachedOracle(new PriceOracle([priceProvider]), { store: new CacheStore(now) });
  const risk = new CachedRiskAssessor(new RiskChecker([riskProvider]), {
    store: new CacheStore(now),
  });
  const limiter = options.limiter ?? new RateLimiter({ now });
  const wallet = new SmartWallet({ oracle: price, riskChecker: risk });

  const app = withErrorHandler(new Hono());
  app.use('/api/v1/*', rateLimitMiddleware(limiter));
  app.route('/api/v1', priceRoutes(wallet));
  app.route('/api/v1', riskRoutes(wallet));
  app.route('/api/v1', cacheRoutes({ price, risk }));
  return { app, price, risk, priceProvider, riskProvider, limiter };
}

/** GETs a path and returns status, body and the rate limit headers. */
async function get(
  app: Hono,
  path: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  json: Record<string, unknown>;
  headers: Headers;
}> {
  const response = await app.request(path, { headers });
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
    headers: response.headers,
  };
}

/** DELETEs a path and returns the status. */
async function remove(app: Hono, path: string): Promise<number> {
  const response = await app.request(path, { method: 'DELETE' });
  return response.status;
}

/** POSTs a JSON body. */
async function post(app: Hono, path: string, body: unknown): Promise<number> {
  const response = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.status;
}

beforeEach(() => {
  clock = 1_800_000_000_000;
});

describe('GET /api/v1/cache/stats', () => {
  it('answers with both cache counters', async () => {
    const { app } = buildApp();

    const { status, json } = await get(app, '/api/v1/cache/stats');

    expect(status).toBe(200);
    expect(json).toEqual({
      price: { hits: 0, misses: 0, size: 0 },
      risk: { hits: 0, misses: 0, size: 0 },
    });
  });

  it('counts a price hit and a miss after a lookup', async () => {
    const { app } = buildApp();

    await get(app, '/api/v1/price/ETH');
    await get(app, '/api/v1/price/ETH');
    const { json } = await get(app, '/api/v1/cache/stats');

    expect(json.price).toEqual({ hits: 1, misses: 1, size: 1 });
  });

  it('counts a risk hit and a miss after a screen', async () => {
    const { app } = buildApp();
    const address = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';

    await post(app, '/api/v1/risk/address', { address });
    await post(app, '/api/v1/risk/address', { address });
    const { json } = await get(app, '/api/v1/cache/stats');

    expect(json.risk).toEqual({ hits: 1, misses: 1, size: 1 });
  });
});

describe('DELETE /api/v1/cache', () => {
  it('answers 204 and empties both caches', async () => {
    const { app } = buildApp();
    await get(app, '/api/v1/price/ETH');
    await post(app, '/api/v1/risk/address', {
      address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    });

    const status = await remove(app, '/api/v1/cache');

    expect(status).toBe(204);
    const { json } = await get(app, '/api/v1/cache/stats');
    // Clearing drops the entries; the lifetime counters stay, so an operator
    // still sees how much work the caches saved.
    expect(json).toEqual({
      price: { hits: 0, misses: 1, size: 0 },
      risk: { hits: 0, misses: 1, size: 0 },
    });
  });

  it('makes the next price lookup a miss', async () => {
    const { app, priceProvider } = buildApp();
    await get(app, '/api/v1/price/ETH');
    expect(priceProvider.calls).toBe(1);

    await remove(app, '/api/v1/cache');
    const { json } = await get(app, '/api/v1/price/ETH');

    expect(priceProvider.calls).toBe(2);
    expect(json.price).toBe(3200);
  });

  it('makes the next risk lookup a miss', async () => {
    const { app, riskProvider } = buildApp();
    await post(app, '/api/v1/risk/address', {
      address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    });

    await remove(app, '/api/v1/cache');
    await post(app, '/api/v1/risk/address', {
      address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    });

    expect(riskProvider.calls).toBe(2);
  });
});

describe('cached price route', () => {
  it('answers the same price twice but queries the provider once', async () => {
    const { app, priceProvider } = buildApp();

    const first = await get(app, '/api/v1/price/ETH');
    const second = await get(app, '/api/v1/price/ETH');

    expect(first.json.price).toBe(3200);
    expect(second.json.price).toBe(3200);
    expect(priceProvider.calls).toBe(1);
  });

  it('queries the provider again for a different symbol', async () => {
    const { app, priceProvider } = buildApp();

    await get(app, '/api/v1/price/ETH');
    await get(app, '/api/v1/price/BTC');

    expect(priceProvider.calls).toBe(2);
  });

  it('still answers 404 for an unknown symbol', async () => {
    const { app } = buildApp();

    const { status, json } = await get(app, '/api/v1/price/UNKNOWN_XYZ');

    expect(status).toBe(404);
    expect(json.code).toBe('SYMBOL_NOT_FOUND');
  });
});

describe('cached risk route', () => {
  it('answers the same verdict twice but queries the providers once', async () => {
    const { app, riskProvider } = buildApp();
    const address = '0x37f53b2d1056e2e07a4aC10AD3B51928cfea0f47';

    const first = await get(app, '/api/v1/price/ETH');
    expect(first.status).toBe(200);
    const one = await post(app, '/api/v1/risk/address', { address });
    const two = await post(app, '/api/v1/risk/address', { address });

    expect(one).toBe(200);
    expect(two).toBe(200);
    expect(riskProvider.calls).toBe(1);
  });

  it('keeps screening a different address', async () => {
    const { app, riskProvider } = buildApp();

    await post(app, '/api/v1/risk/address', {
      address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    });
    await post(app, '/api/v1/risk/address', {
      address: '0x37f53b2d1056e2e07a4aC10AD3B51928cfea0f47',
    });

    expect(riskProvider.calls).toBe(2);
  });
});

describe('rate limiting', () => {
  it('lets the first 60 requests through and rejects the 61st', async () => {
    const { app } = buildApp();

    for (let index = 0; index < 60; index += 1) {
      const { status } = await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.1' });
      expect(status).toBe(200);
    }

    const { status, json } = await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.1' });

    expect(status).toBe(429);
    expect((json.error as { code: string }).code).toBe('RATE_LIMITED');
    expect(typeof (json.error as { message: string }).message).toBe('string');
    expect(typeof json.retryAfter).toBe('number');
    expect(json.retryAfter as number).toBeGreaterThan(0);
    expect(json.retryAfter as number).toBeLessThanOrEqual(60);
  });

  it('stamps the rate limit headers onto a normal answer', async () => {
    const { app } = buildApp();

    const { headers } = await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.2' });

    expect(headers.get('X-RateLimit-Limit')).toBe('60');
    expect(headers.get('X-RateLimit-Remaining')).toBe('59');
    expect(Number(headers.get('X-RateLimit-Reset'))).toBeGreaterThan(1_700_000_000);
  });

  it('counts the remaining budget down', async () => {
    const { app } = buildApp();

    const first = await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.3' });
    const second = await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.3' });

    expect(first.headers.get('X-RateLimit-Remaining')).toBe('59');
    expect(second.headers.get('X-RateLimit-Remaining')).toBe('58');
  });

  it('lets requests through again once the window has passed', async () => {
    const { app } = buildApp();

    for (let index = 0; index < 60; index += 1) {
      await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.4' });
    }
    expect((await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.4' })).status).toBe(
      429,
    );

    clock += 60_001;

    const { status, headers } = await get(app, '/api/v1/price/ETH', {
      'x-forwarded-for': '10.0.0.4',
    });
    expect(status).toBe(200);
    expect(headers.get('X-RateLimit-Remaining')).toBe('59');
  });

  it('keeps every client in its own bucket', async () => {
    const { app } = buildApp();

    for (let index = 0; index < 60; index += 1) {
      await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.5' });
    }
    const blocked = await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.5' });
    const other = await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.6' });

    expect(blocked.status).toBe(429);
    expect(other.status).toBe(200);
  });

  it('stamps the headers onto the 429 answer too', async () => {
    const limiter = new RateLimiter({ limit: 1, now });
    const { app } = buildApp({ limiter });

    await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.7' });
    const { headers } = await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.7' });

    expect(headers.get('X-RateLimit-Limit')).toBe('1');
    expect(headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(headers.get('Retry-After')).toBeDefined();
  });

  it('honours a custom limit', async () => {
    const { app } = buildApp({ limiter: new RateLimiter({ limit: 3, now }) });

    for (let index = 0; index < 3; index += 1) {
      expect((await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.8' })).status).toBe(
        200,
      );
    }

    expect((await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.8' })).status).toBe(
      429,
    );
  });

  it('does not count a rejected request against the next window', async () => {
    const { app } = buildApp({ limiter: new RateLimiter({ limit: 1, now }) });

    await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.9' });
    await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.9' });
    clock += 60_001;
    const { headers } = await get(app, '/api/v1/price/ETH', { 'x-forwarded-for': '10.0.0.9' });

    expect(headers.get('X-RateLimit-Remaining')).toBe('0');
  });
});

describe('cache isolation between apps', () => {
  it('does not let one app read a price another app cached', async () => {
    const provider = countingPriceProvider({ ETH: 3200 });
    // Two apps that share nothing but the provider they count.
    const apps = [0, 1].map(() => {
      // Each app builds its own cached oracle and hands it to its own wallet,
      // which is the wiring `createApp` now uses.
      const price = new CachedOracle(new PriceOracle([provider]), {
        store: new CacheStore(now),
      });
      const app = withErrorHandler(new Hono());
      app.route('/api/v1', priceRoutes(new SmartWallet({ oracle: price })));
      return app;
    });

    const before = provider.calls;
    await get(apps[0] as Hono, '/api/v1/price/ETH');
    await get(apps[1] as Hono, '/api/v1/price/ETH');

    // Two apps, two misses: the second did not inherit the first's entry.
    expect(provider.calls).toBe(before + 2);
  });
});
