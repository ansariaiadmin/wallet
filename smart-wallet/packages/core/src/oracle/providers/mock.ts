import type { PriceProvider, PriceRequest, TokenPrice } from '../types';

/** One deterministic price entry: USD price plus 24 hour change in bps. */
export interface MockPrice {
  readonly usdPrice: number;
  readonly change24hBps: number;
}

/**
 * Builds a deterministic {@link PriceProvider} from a static price table.
 *
 * The provider upper-cases every requested symbol, returns the entries it
 * knows and silently omits the ones it does not — a partial answer is not an
 * error. Only `updatedAt` reads the clock, so two calls for the same symbol
 * always report the same price.
 */
export function createMockProvider(
  name: string,
  table: Readonly<Record<string, MockPrice>>,
): PriceProvider {
  return {
    name,
    async fetchPrices(req: PriceRequest): Promise<ReadonlyMap<string, TokenPrice>> {
      const prices = new Map<string, TokenPrice>();
      const updatedAt = Math.floor(Date.now() / 1000);

      for (const requested of req.symbols) {
        const symbol = requested.trim().toUpperCase();
        // Guarded read: symbols outside this provider's list are skipped.
        const entry = table[symbol];
        if (entry === undefined) {
          continue;
        }
        prices.set(symbol, {
          symbol,
          usdPrice: entry.usdPrice,
          change24hBps: entry.change24hBps,
          confidence: 'high',
          updatedAt,
          source: name,
        });
      }

      return prices;
    },
  };
}
