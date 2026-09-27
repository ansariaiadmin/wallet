import type { SwapFamily, SwapQuote, SwapRequest } from '../types';

/** True only when the request targets `family`. */
export function mockSupports(family: SwapFamily, req: SwapRequest): boolean {
  return req.family === family;
}

/**
 * Builds the deterministic quote every mock adapter returns.
 *
 * The quote simulates 3% slippage (`amountOut = amountIn * 97 / 100`), a flat
 * 30 bps fee, a flat 50 bps price impact and a 60 second lifetime. It performs
 * no network call, holds no state and needs no API key, so the router can be
 * exercised end to end without touching a real aggregator.
 */
export function mockQuote(aggregator: string, req: SwapRequest): SwapQuote {
  const amountOut = (req.amountIn * 97n) / 100n;
  return {
    aggregator,
    fromToken: req.fromToken,
    toToken: req.toToken,
    amountIn: req.amountIn,
    amountOut,
    feeBps: 30,
    priceImpactBps: 50,
    unsignedTx: {
      mock: true,
      adapter: aggregator,
      family: req.family,
      chainId: req.chainId ?? null,
      fromToken: req.fromToken,
      toToken: req.toToken,
      amountIn: req.amountIn,
      amountOut,
      slippageBps: req.slippageBps,
      fromAddress: req.fromAddress,
    },
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    meta: {},
  };
}
