import type { AggregatorAdapter, SwapFamily, SwapQuote, SwapRequest } from './types';
import { RouterError } from './types';

// The in-memory handler registry lived here first and is re-exported so the
// `@router/router` import path used by `@api` keeps resolving.
export * from './registry';

/** Families the router can route a swap on. */
const SWAP_FAMILIES: readonly SwapFamily[] = ['evm', 'solana', 'tron'];

/** What one pass over the registered adapters produced. */
interface CollectedQuotes {
  /** Quotes from the adapters that succeeded, in adapter order. */
  readonly quotes: SwapQuote[];
  /** `{ adapter, error }` pairs for the adapters that failed. */
  readonly errors: { adapter: string; error: unknown }[];
  /** The adapters that claimed the request, in registration order. */
  readonly adapters: readonly AggregatorAdapter[];
}

/** Validates the parts of a request every adapter relies on. */
function validateRequest(req: SwapRequest): void {
  if (typeof req !== 'object' || req === null) {
    throw new RouterError('INVALID_INPUT', 'a swap request object is required');
  }
  if (typeof req.amountIn !== 'bigint' || req.amountIn <= 0n) {
    throw new RouterError('INVALID_INPUT', 'amountIn must be a bigint greater than zero');
  }
  if (typeof req.slippageBps !== 'number' || req.slippageBps < 0 || req.slippageBps > 10_000) {
    throw new RouterError('INVALID_INPUT', 'slippageBps must be between 0 and 10000 basis points');
  }
  if (typeof req.fromToken !== 'string' || typeof req.toToken !== 'string') {
    throw new RouterError('INVALID_INPUT', 'fromToken and toToken must be strings');
  }
  if (req.fromToken === req.toToken) {
    throw new RouterError('INVALID_INPUT', 'fromToken and toToken must be different tokens');
  }
}

/** Returns the family, rejecting anything outside {@link SWAP_FAMILIES}. */
function requireFamily(req: SwapRequest): SwapFamily {
  const family: unknown = req.family;
  if (typeof family !== 'string' || !SWAP_FAMILIES.includes(family as SwapFamily)) {
    throw new RouterError('UNSUPPORTED_FAMILY', `unsupported swap family: ${String(family)}`);
  }
  return family as SwapFamily;
}

/** Higher `amountOut` first, ties keep their original (adapter) order. */
function compareQuotes(left: SwapQuote, right: SwapQuote): number {
  if (right.amountOut === left.amountOut) return 0;
  return right.amountOut > left.amountOut ? 1 : -1;
}

/**
 * Chain-agnostic swap router.
 *
 * The router holds a list of {@link AggregatorAdapter}s, asks the ones that
 * support a request for a quote and returns the best one. It never signs, never
 * touches a key, makes no network call of its own and keeps no state between
 * calls, so the same instance can be shared and reused freely.
 */
export class SwapRouter {
  private readonly adapters: AggregatorAdapter[];

  constructor(adapters: AggregatorAdapter[]) {
    this.adapters = adapters;
  }

  /**
   * Returns the quote with the highest `amountOut` among the adapters that
   * support `req`.
   *
   * @throws RouterError `INVALID_INPUT` when the request is malformed,
   *   `UNSUPPORTED_FAMILY` for an unknown family, `NO_ROUTE` when no adapter
   *   supports the request and `AGGREGATOR_ERROR` when every adapter that
   *   supports it failed.
   */
  async bestQuote(req: SwapRequest): Promise<SwapQuote> {
    const collected = await this.collect(req);
    if (collected.adapters.length === 0) {
      throw new RouterError(
        'NO_ROUTE',
        `no aggregator supports ${String(req.family)} swaps for ${req.fromToken} → ${req.toToken}`,
      );
    }
    if (collected.quotes.length === 0) {
      throw new RouterError(
        'AGGREGATOR_ERROR',
        `every aggregator that supports this swap failed (${collected.adapters.length} tried)`,
        collected.errors,
      );
    }
    const [first, ...rest] = collected.quotes;
    if (first === undefined) {
      throw new RouterError('AGGREGATOR_ERROR', 'no quote was produced for this swap');
    }
    return rest.reduce((best, quote) => (quote.amountOut > best.amountOut ? quote : best), first);
  }

  /**
   * Returns every quote from the supporting adapters, best-first. A single
   * adapter failure never rejects the call: the failing adapter is skipped and
   * its error is collected for the caller to inspect via {@link bestQuote}.
   *
   * @throws RouterError `INVALID_INPUT` or `UNSUPPORTED_FAMILY` for a request
   *   the router itself cannot make sense of.
   */
  async allQuotes(req: SwapRequest): Promise<SwapQuote[]> {
    const collected = await this.collect(req);
    return [...collected.quotes].sort(compareQuotes);
  }

  /** Validates `req` and asks every supporting adapter for a quote. */
  private async collect(req: SwapRequest): Promise<CollectedQuotes> {
    validateRequest(req);
    requireFamily(req);

    const adapters = this.adapters.filter((adapter) => adapter.supports(req));
    if (adapters.length === 0) {
      return { quotes: [], errors: [], adapters: [] };
    }

    const settled = await Promise.allSettled(adapters.map((adapter) => adapter.quote(req)));
    const quotes: SwapQuote[] = [];
    const errors: { adapter: string; error: unknown }[] = [];
    for (const [index, result] of settled.entries()) {
      if (result.status === 'fulfilled') {
        quotes.push(result.value);
      } else {
        errors.push({ adapter: adapters[index]?.name ?? 'unknown', error: result.reason });
      }
    }
    return { quotes, errors, adapters };
  }
}
