import { Hono } from 'hono';
import type { CachedOracle, CachedRiskAssessor } from '@wallet/core';

/** The two caches the endpoints report on and clear. */
export interface CacheDeps {
  readonly price: CachedOracle;
  readonly risk: CachedRiskAssessor;
}

/**
 * Cache introspection and invalidation.
 *
 * `GET /cache/stats` answers with the hit/miss counters and the occupancy of
 * both caches, so an operator can see whether the TTLs are doing anything.
 * `DELETE /cache` drops both, which is the lever for "the price moved, forget
 * what you know".
 */
export function cacheRoutes(deps: CacheDeps): Hono {
  return new Hono()
    .get('/cache/stats', (c) =>
      c.json({ price: deps.price.cacheStats(), risk: deps.risk.cacheStats() }, 200),
    )
    .delete('/cache', (c) => {
      deps.price.clearCache();
      deps.risk.clearCache();
      return c.body(null, 204);
    });
}
