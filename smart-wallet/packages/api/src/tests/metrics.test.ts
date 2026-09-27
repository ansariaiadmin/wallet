import { describe, expect, it } from 'vitest';
import { LATENCY_BUCKETS_MS, MetricsRegistry } from '../metrics';

/** A clock the test moves by hand. */
function clock(start = 1_000_000): { readonly now: () => number; advance: (ms: number) => void } {
  let value = start;
  return { now: () => value, advance: (ms: number) => (value += ms) };
}

describe('MetricsRegistry', () => {
  it('counts requests and errors per route', () => {
    const metrics = new MetricsRegistry();

    metrics.record('/price', 200, 5);
    metrics.record('/price', 500, 5);
    metrics.record('/risk', 200, 5);

    const snapshot = metrics.snapshot();
    expect(snapshot.get('/price')).toMatchObject({ requests: 2, errors: 1 });
    expect(snapshot.get('/risk')).toMatchObject({ requests: 1, errors: 0 });
    expect(metrics.totals()).toEqual({ requests: 3, errors: 1 });
  });

  it('counts a 4xx as an error and a 3xx as neither', () => {
    const metrics = new MetricsRegistry();

    metrics.record('/a', 302, 1);
    metrics.record('/b', 404, 1);
    metrics.record('/c', 429, 1);

    expect(metrics.totals()).toEqual({ requests: 3, errors: 2 });
  });

  it('buckets a duration into the first boundary it fits', () => {
    const metrics = new MetricsRegistry();

    metrics.record('/a', 200, 4);
    metrics.record('/a', 200, 6);
    metrics.record('/a', 200, 99_999);

    const buckets = metrics.snapshot().get('/a')?.buckets ?? [];
    // 4ms lands in the first bucket (<=5), 6ms in the second (<=10), and the
    // overflow lands in the trailing +Inf bucket.
    expect(buckets[0]).toBe(1);
    expect(buckets[1]).toBe(1);
    expect(buckets[LATENCY_BUCKETS_MS.length]).toBe(1);
  });

  it('keeps a status distribution per route', () => {
    const metrics = new MetricsRegistry();

    metrics.record('/a', 200, 1);
    metrics.record('/a', 200, 1);
    metrics.record('/a', 409, 1);

    expect([
      ...((metrics.snapshot().get('/a')?.statuses ?? new Map()) as Map<number, number>),
    ]).toEqual([
      [200, 2],
      [409, 1],
    ]);
  });

  it('reports uptime from the injected clock', () => {
    const time = clock();
    const metrics = new MetricsRegistry(time.now);

    expect(metrics.uptimeSeconds()).toBe(0);
    time.advance(2_500);
    expect(metrics.uptimeSeconds()).toBe(2.5);
  });

  it('never reports a negative uptime', () => {
    const metrics = new MetricsRegistry(() => 5);
    metrics.record('/a', 200, 1);
    expect(metrics.uptimeSeconds()).toBeGreaterThanOrEqual(0);
  });

  it('exposes Prometheus counters with a route label', () => {
    const metrics = new MetricsRegistry();
    metrics.record('/price', 200, 3);

    const text = metrics.toPrometheus();

    expect(text).toContain('wallet_http_requests_total{route="/price"} 1');
    expect(text).toContain('wallet_http_errors_total{route="/price"} 0');
    expect(text).toContain('# TYPE wallet_http_requests_total counter');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('quotes and escapes a route label that would break the format', () => {
    const metrics = new MetricsRegistry();
    metrics.record('/a"b\\c', 200, 1);

    expect(metrics.toPrometheus()).toContain('route="/a\\"b\\\\c"');
  });

  it('keeps two registries independent', () => {
    const first = new MetricsRegistry();
    const second = new MetricsRegistry();

    first.record('/a', 200, 1);

    expect(first.totals().requests).toBe(1);
    expect(second.totals().requests).toBe(0);
  });
});
