import { Hono } from 'hono';
import type { CachedOracle } from '@wallet/core';
import { ApiError } from '../errors';
import { isNonEmptyString } from '../validation';

/**
 * Price lookup backed by the cached P7 oracle.
 *
 * `GET /price/:symbol` answers with the aggregated USD price, the 24 hour
 * change in basis points and the confidence the oracle derived from how many
 * providers contributed. `SYMBOL_NOT_FOUND` and `ALL_FAILED` are thrown by the
 * oracle and turned into 404 and 503 by the global error handler.
 */
export function priceRoutes(oracle: CachedOracle): Hono {
  return new Hono().get('/price/:symbol', async (c) => {
    const symbol = c.req.param('symbol');
    if (!isNonEmptyString(symbol)) {
      throw new ApiError(400, 'INVALID_INPUT', 'symbol is required');
    }

    const price = await oracle.fetchPrice(symbol);

    return c.json(
      {
        symbol: price.symbol,
        price: price.usdPrice,
        change24h: price.change24hBps,
        confidence: price.confidence,
        ts: price.updatedAt,
      },
      200,
    );
  });
}
