import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createApp, withErrorHandler } from '../app';
import { nullLogger, type Logger } from '../logger';
import { MetricsRegistry } from '../metrics';

/** Builds an app whose logger records into an array instead of the console. */
function appWithLogger(): { readonly app: Hono; readonly lines: string[] } {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (m, f) => lines.push(JSON.stringify({ msg: m, ...f })),
    info: (m, f) => lines.push(JSON.stringify({ msg: m, ...f })),
    warn: (m, f) => lines.push(JSON.stringify({ msg: m, ...f })),
    error: (m, f) => lines.push(JSON.stringify({ msg: m, ...f })),
    child: () => logger,
  };
  return { app: createApp({ logger, metrics: new MetricsRegistry(() => 1_000_000) }), lines };
}

describe('GET /api/v1/metrics', () => {
  it('answers Prometheus text by default', async () => {
    const { app } = appWithLogger();

    const response = await app.request('/api/v1/metrics');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toContain('wallet_http_requests_total');
  });

  it('answers JSON when asked', async () => {
    const { app } = appWithLogger();

    const response = await app.request('/api/v1/metrics', {
      headers: { accept: 'application/json' },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { requests: number; routes: Record<string, unknown> };
    // The request being answered is not counted yet: the counter is written
    // after the handler returns, so the body describes every *earlier* request.
    expect(body.requests).toBe(0);
    expect(body.routes).toEqual({});
  });

  it('counts an earlier request under its route pattern', async () => {
    const { app } = appWithLogger();

    await app.request('/api/v1/price/ETH');
    await app.request('/api/v1/price/ETH');
    const response = await app.request('/api/v1/metrics', {
      headers: { accept: 'application/json' },
    });
    const body = (await response.json()) as {
      routes: Record<string, { requests: number }>;
    };

    // The label is the matched pattern, not the concrete path, so the series
    // stays bounded by the number of routes rather than by traffic.
    expect(body.routes['/api/v1/price/:symbol']?.requests).toBe(2);
  });

  it('keeps the metric series bounded by route, not by traffic', async () => {
    const { app } = appWithLogger();

    for (const symbol of ['ETH', 'BTC', 'SOL', 'MATIC']) {
      await app.request(`/api/v1/price/${symbol}`);
    }
    const response = await app.request('/api/v1/metrics', {
      headers: { accept: 'application/json' },
    });
    const body = (await response.json()) as { routes: Record<string, unknown> };

    expect(Object.keys(body.routes)).toEqual(['/api/v1/price/:symbol']);
  });
});

describe('GET /api/v1/health', () => {
  it('still answers ok and now carries counters', async () => {
    const { app } = appWithLogger();

    const response = await app.request('/api/v1/health');

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({ status: 'ok' });
  });

  it('reports the requests it has served', async () => {
    const { app } = appWithLogger();

    await app.request('/api/v1/price/ETH');
    const body = (await (await app.request('/api/v1/health')).json()) as { requests: number };

    // One served request; the health call itself is not counted yet.
    expect(body.requests).toBe(1);
  });
});

describe('request logging', () => {
  it('logs a 4xx as a warn and not as an error', async () => {
    const { app, lines } = appWithLogger();

    await app.request('/api/v1/price/');

    expect(lines.some((line) => line.includes('request rejected'))).toBe(true);
    expect(lines.some((line) => line.includes('request failed'))).toBe(false);
  });

  it('logs an unhandled failure as an error with a code and no stack', async () => {
    const lines: string[] = [];
    const logger: Logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (m, f) => lines.push(JSON.stringify({ msg: m, ...f })),
      child: () => logger,
    };
    const app = withErrorHandler(new Hono(), logger);
    app.get('/boom', () => {
      throw new Error('kaboom');
    });

    await app.request('/boom');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('unhandled API error');
    expect(lines[0]).toContain('kaboom');
    expect(lines[0]).not.toContain('at ');
  });

  it('stays quiet with nullLogger', async () => {
    const app = createApp({ logger: nullLogger });

    const response = await app.request('/api/v1/price/ETH');

    expect(response.status).toBe(200);
  });
});
