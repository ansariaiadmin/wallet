import { Hono } from 'hono';
import type { RiskChecker } from '@wallet/core';
import { readJsonObject, requireString, optionalString } from '../request';

/**
 * Screening endpoints backed by the P8 heuristic checker.
 *
 * Both routes only validate that the required field is present: the level and
 * the reasons come from the providers, and the merged verdict is returned
 * as-is. The checker throws `RiskError`, which the global handler maps to
 * 400 (invalid input) or 503 (every provider failed).
 */
export function riskRoutes(checker: RiskChecker): Hono {
  return new Hono()
    .post('/risk/address', async (c) => {
      const body = await readJsonObject(c);
      const address = requireString(body, 'address');
      const chain = optionalString(body, 'chain');

      const result = await checker.assessAddress({ address, chain });
      return c.json(
        {
          overallRisk: result.overallRisk,
          flags: result.flags,
          assessedAt: result.assessedAt,
        },
        200,
      );
    })
    .post('/risk/token', async (c) => {
      const body = await readJsonObject(c);
      const symbol = requireString(body, 'symbol');
      const chain = optionalString(body, 'chain');

      const result = await checker.assessToken({ symbol, chain });
      return c.json(
        {
          overallRisk: result.overallRisk,
          flags: result.flags,
          assessedAt: result.assessedAt,
        },
        200,
      );
    });
}
