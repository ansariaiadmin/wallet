import { median } from './median';
import type { PriceProvider, PriceRequest, PriceResult, TokenPrice } from './types';
import { OracleError } from './types';

/** What one provider contributed to the aggregation. */
interface ProviderOutcome {
  readonly name: string;
  readonly prices: ReadonlyMap<string, TokenPrice>;
}

/**
 * Merges several {@link PriceProvider}s into one price feed.
 *
 * Every call queries all providers in parallel and aggregates per symbol: the
 * median USD price, the median 24 hour change, and a confidence derived from
 * how many providers answered. Providers that fail are skipped, never fatal —
 * only a total failure is. The oracle keeps no state between calls.
 */
export class PriceOracle {
  private readonly providers: PriceProvider[];

  constructor(providers: PriceProvider[]) {
    this.providers = providers;
  }

  /**
   * Fetches and aggregates prices for every requested symbol.
   *
   * Symbols are upper-cased and deduplicated before any provider is queried.
   *
   * @throws OracleError `NO_PROVIDER` when no provider was configured,
   *   `ALL_FAILED` when every provider threw, and `SYMBOL_NOT_FOUND` when no
   *   provider returned any of the requested symbols.
   */
  async fetchPrices(req: PriceRequest): Promise<PriceResult> {
    if (this.providers.length === 0) {
      throw new OracleError('NO_PROVIDER', 'no price provider was configured');
    }

    const symbols = dedupeSymbols(req.symbols);
    const outcomes = await this.queryProviders(symbols);
    if (outcomes.length === 0) {
      throw new OracleError(
        'ALL_FAILED',
        `every price provider failed (${this.providers.length} tried)`,
        this.providers.map((provider) => provider.name),
      );
    }

    const prices = new Map<string, TokenPrice>();
    const missing: string[] = [];
    for (const symbol of symbols) {
      const entries: TokenPrice[] = [];
      const contributors: string[] = [];
      for (const outcome of outcomes) {
        const price = outcome.prices.get(symbol);
        if (price !== undefined) {
          entries.push(price);
          contributors.push(outcome.name);
        }
      }
      if (entries.length === 0) {
        missing.push(symbol);
        continue;
      }
      prices.set(symbol, {
        symbol,
        usdPrice: median(entries.map((entry) => entry.usdPrice)),
        change24hBps: median(entries.map((entry) => entry.change24hBps)),
        // Two or more providers that agree are 'high', a lone provider is
        // 'medium', and 'low' stays reserved for a fallback-only price.
        confidence: entries.length >= 2 ? 'high' : 'medium',
        updatedAt: Math.max(...entries.map((entry) => entry.updatedAt)),
        source: contributors.join(','),
      });
    }

    if (missing.length > 0) {
      throw new OracleError(
        'SYMBOL_NOT_FOUND',
        `no provider returned a price for: ${missing.join(', ')}`,
        missing,
      );
    }

    return { prices, fetchedAt: Math.floor(Date.now() / 1000) };
  }

  /**
   * Convenience wrapper around {@link fetchPrices} for a single symbol.
   *
   * @throws OracleError `SYMBOL_NOT_FOUND` when no provider knows the symbol.
   */
  async fetchPrice(symbol: string): Promise<TokenPrice> {
    const requested = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    const result = await this.fetchPrices({ symbols: [requested] });
    const price = result.prices.get(requested);
    if (price === undefined) {
      throw new OracleError('SYMBOL_NOT_FOUND', `no provider returned a price for ${symbol}`);
    }
    return price;
  }

  /** Queries every provider in parallel and keeps the ones that answered. */
  private async queryProviders(symbols: readonly string[]): Promise<ProviderOutcome[]> {
    const settled = await Promise.allSettled(
      this.providers.map((provider) => provider.fetchPrices({ symbols })),
    );

    const outcomes: ProviderOutcome[] = [];
    for (const [index, result] of settled.entries()) {
      if (result.status === 'fulfilled') {
        outcomes.push({
          // Guarded index read: the settled array always matches `providers`.
          name: this.providers[index]?.name ?? 'unknown',
          prices: result.value,
        });
      }
    }
    return outcomes;
  }
}

/** Upper-cases, trims and deduplicates the requested symbols, order preserved. */
function dedupeSymbols(symbols: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const symbol of symbols) {
    if (typeof symbol !== 'string') {
      continue;
    }
    const normalized = symbol.trim().toUpperCase();
    if (normalized === '' || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}
