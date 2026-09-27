import { Hono } from 'hono';
import { toSdkError, type SmartWallet } from '@wallet/sdk';
import { ApiError } from '../errors';
import { isNonEmptyString } from '../validation';

/**
 * Price lookup backed by the cached P7 oracle.
 *
 * `GET /price/:symbol` answers with the aggregated USD price, the 24 hour
 * change in basis points, the confidence the oracle derived from how many
 * providers contributed, and when the price was produced. `SYMBOL_NOT_FOUND`
 * and `ALL_FAILED` are thrown upstream and turned into 404 and 503 by the
 * global error handler.
 *
 * The lookup runs through `SmartWallet.getPrice` rather than the oracle
 * directly, so the api and the sdk cannot disagree about what a price is.
 */
export function priceRoutes(wallet: SmartWallet): Hono {
  return new Hono().get('/price/:symbol', async (c) => {
    const symbol = c.req.param('symbol');
    if (!isNonEmptyString(symbol)) {
      throw new ApiError(400, 'INVALID_INPUT', 'symbol is required');
    }

    let price;
    try {
      price = await wallet.getPrice(symbol);
    } catch (error) {
      const sdkError = toSdkError(error, 'INTERNAL');
      if (sdkError.code === 'INVALID_INPUT') {
        throw new ApiError(400, 'INVALID_INPUT', sdkError.message);
      }
      if (sdkError.code === 'SYMBOL_NOT_FOUND') {
        throw new ApiError(404, 'SYMBOL_NOT_FOUND', sdkError.message);
      }
      throw new ApiError(503, 'PRICE_UNAVAILABLE', sdkError.message);
    }

    return c.json(
      {
        symbol: price.symbol,
        price: price.price,
        change24h: price.change24h,
        confidence: price.confidence,
        ts: price.updatedAt,
      },
      200,
    );
  });
}
