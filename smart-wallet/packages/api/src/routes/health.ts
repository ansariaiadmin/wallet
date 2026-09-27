import { Hono } from 'hono';
import { MetricsRegistry } from '../metrics';

/** What a health probe needs; production passes the app's own registry. */
export interface HealthDeps {
  readonly registry?: MetricsRegistry;
  /** Seconds the process has been up. Defaults to the registry's own clock. */
  readonly now?: () => number;
}

/**
 * Liveness probe.
 *
 * It answers from memory: no dependency is called and no socket is opened, so a
 * probe cannot be the thing that takes the service down. The counters are
 * included because "up" and "up but answering 500 to everything" are different
 * operational states, and a probe that can tell them apart is worth the two
 * extra fields.
 */
export function healthRoutes(deps: HealthDeps = {}): Hono {
  const registry = deps.registry ?? new MetricsRegistry(deps.now);
  return new Hono().get('/health', (c) => {
    const { requests, errors } = registry.totals();
    return c.json(
      {
        status: 'ok',
        ts: Math.floor(Date.now() / 1000),
        uptimeSeconds: Number(registry.uptimeSeconds().toFixed(3)),
        requests,
        errors,
      },
      200,
    );
  });
}
