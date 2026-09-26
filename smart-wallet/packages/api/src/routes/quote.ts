import { Hono } from 'hono';
import type { SwapQuote, SwapRouter } from '@wallet/router';
import { ApiError } from '../errors';
import { EVM_CHAIN_IDS, familyOf } from '../chains';
import { readJsonObject, optionalString, requireString } from '../request';
import { isPositiveNumberString } from '../validation';

/** One quote as it goes over the wire. */
export interface QuoteResult {
  adapter: string;
  fromToken: string;
  toToken: string;
  /** Amount sold, decimal string in the smallest unit of `fromToken`. */
  amountIn: string;
  /** Minimum amount received after slippage, same unit as `toToken`. */
  amountOut: string;
  /** Aggregator fee in basis points; the mocks have no fee amount yet. */
  estimatedFee: number;
}

/** Slippage used when the caller does not pass one: 0.5%. */
const DEFAULT_SLIPPAGE_BPS = 50;

/** Placeholder signer for quote-only requests that carry no address. */
const UNKNOWN_SENDER = 'unknown';

/**
 * Quote endpoint backed by the P6 swap router.
 *
 * `POST /quote` answers with the best route plus every route the router found.
 * A chain pair no adapter covers is not an error: `best` comes back `null` and
 * `all` comes back empty, which is exactly what the router reports when no
 * adapter supports the request.
 */
export function quoteRoutes(router: SwapRouter): Hono {
  return new Hono().post('/quote', async (c) => {
    const body = await readJsonObject(c);
    const fromChain = requireString(body, 'fromChain');
    const toChain = requireString(body, 'toChain');
    const fromToken = requireString(body, 'fromToken');
    const toToken = requireString(body, 'toToken');
    const amount = body.amount;
    if (!isPositiveNumberString(amount)) {
      throw new ApiError(
        400,
        'INVALID_AMOUNT',
        'amount must be a positive integer string in the smallest token unit',
      );
    }

    const family = familyOf(fromChain);
    if (family === undefined) {
      throw new ApiError(400, 'UNSUPPORTED_CHAIN', `unsupported fromChain: ${fromChain}`);
    }
    if (familyOf(toChain) !== family) {
      throw new ApiError(
        400,
        'UNSUPPORTED_CHAIN',
        `cross-chain quotes are not supported: ${fromChain} → ${toChain}`,
      );
    }

    const request = {
      family,
      chainId: family === 'evm' ? EVM_CHAIN_IDS[fromChain.trim().toLowerCase()] : undefined,
      fromToken,
      toToken,
      amountIn: BigInt(amount),
      slippageBps: DEFAULT_SLIPPAGE_BPS,
      fromAddress: optionalString(body, 'fromAddress') ?? UNKNOWN_SENDER,
    };

    const all = await router.allQuotes(request);
    if (all.length === 0) {
      // No adapter covers this chain pair; bestQuote would reject NO_ROUTE.
      return c.json({ best: null, all: [] }, 200);
    }

    const best = await router.bestQuote(request);
    return c.json({ best: toQuoteResult(best), all: all.map(toQuoteResult) }, 200);
  });
}

/** Renders a quote with bigint amounts as decimal strings. */
function toQuoteResult(quote: SwapQuote): QuoteResult {
  return {
    adapter: quote.aggregator,
    fromToken: quote.fromToken,
    toToken: quote.toToken,
    amountIn: quote.amountIn.toString(),
    amountOut: quote.amountOut.toString(),
    estimatedFee: quote.feeBps,
  };
}
