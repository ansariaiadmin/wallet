import { Hono } from 'hono';
import { MetricsRegistry } from '../metrics';

/** Dependencies the metrics route needs; production passes the app's registry. */
export interface MetricsDeps {
  readonly registry?: MetricsRegistry;
}

/**
 * `GET /api/v1/metrics` — Prometheus text, `Accept` permitting.
 *
 * JSON is returned when the caller asks for it with `Accept: application/json`,
 * because a dashboard scraping this by hand is a real case and the counters are
 * the same either way.
 */
export function metricsRoutes(deps: MetricsDeps = {}): Hono {
  const registry = deps.registry ?? new MetricsRegistry();
  return new Hono().get('/metrics', (c) => {
    const wantsJson = (c.req.header('accept') ?? '').includes('application/json');
    if (wantsJson) {
      const { requests, errors } = registry.totals();
      const routes: Record<string, unknown> = {};
      for (const [route, counters] of registry.snapshot()) {
        routes[route] = {
          requests: counters.requests,
          errors: counters.errors,
          meanMs: counters.requests === 0 ? 0 : counters.totalMs / counters.requests,
        };
      }
      return c.json({ uptimeSeconds: registry.uptimeSeconds(), requests, errors, routes });
    }
    return c.text(registry.toPrometheus(), 200, { 'content-type': 'text/plain; version=0.0.4' });
  });
}
