/** Transaction families the swap router knows how to route on. */
export type SwapFamily = 'evm' | 'solana' | 'tron';

/** Everything an aggregator needs to price a swap. */
export interface SwapRequest {
  readonly family: SwapFamily;
  /** EVM only; ignored for Solana and TRON. */
  readonly chainId?: number;
  /** Contract address of the token sold, or the family native sentinel. */
  readonly fromToken: string;
  /** Contract address of the token bought, or the family native sentinel. */
  readonly toToken: string;
  /** Amount sold, in the smallest unit of `fromToken` (wei / lamport / sun). */
  readonly amountIn: bigint;
  /** Slippage tolerance in basis points: `50` means 0.5%. */
  readonly slippageBps: number;
  /** Address that will sign the returned transaction. */
  readonly fromAddress: string;
}

/** A priced route plus the transaction the caller still has to sign. */
export interface SwapQuote {
  /** Name of the adapter that produced the quote. */
  readonly aggregator: string;
  readonly fromToken: string;
  readonly toToken: string;
  readonly amountIn: bigint;
  /** Minimum amount of `toToken` the caller accepts after slippage. */
  readonly amountOut: bigint;
  /** Aggregator fee in basis points. */
  readonly feeBps: number;
  /** Price impact of the swap in basis points. */
  readonly priceImpactBps: number;
  /**
   * Pass-through transaction payload. Its shape depends on the family and the
   * adapter; the router never inspects it.
   */
  readonly unsignedTx: unknown;
  /** Unix timestamp (seconds) after which the quote is stale. */
  readonly expiresAt: number;
  /** Adapter specific extras. */
  readonly meta: Record<string, unknown>;
}

/** One aggregator implementation: a mock today, a real SDK later. */
export interface AggregatorAdapter {
  readonly name: string;
  readonly supportedFamilies: ReadonlyArray<SwapFamily>;
  /** True when this adapter can quote `req`. */
  supports(req: SwapRequest): boolean;
  /** Prices `req`; rejects with the underlying aggregator error. */
  quote(req: SwapRequest): Promise<SwapQuote>;
}

/** Machine readable reason a swap request could not be routed. */
export type RouterErrorCode =
  'NO_ROUTE' | 'AGGREGATOR_ERROR' | 'INVALID_INPUT' | 'UNSUPPORTED_FAMILY';

/** Raised for every routing failure, always carrying a {@link RouterErrorCode}. */
export class RouterError extends Error {
  constructor(
    public readonly code: RouterErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RouterError';
  }
}
