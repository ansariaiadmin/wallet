/** How much the oracle trusts a price it aggregated. */
export type PriceConfidence = 'high' | 'medium' | 'low';

/** One symbol's price as reported by a single provider. */
export interface TokenPrice {
  /** Upper-cased ticker, e.g. `ETH`, `USDC`. */
  symbol: string;
  /** USD price; `0` only when the price is truly unavailable. */
  usdPrice: number;
  /** 24 hour change in basis points, signed: `150` means +1.5%. */
  change24hBps: number;
  confidence: PriceConfidence;
  /** Unix timestamp (seconds) the provider last refreshed this price. */
  updatedAt: number;
  /** Name of the provider that reported the price. */
  source: string;
}

/** What the caller wants priced. Symbols are deduplicated by the oracle. */
export interface PriceRequest {
  readonly symbols: ReadonlyArray<string>;
}

/** Aggregated prices keyed by upper-cased symbol. */
export interface PriceResult {
  readonly prices: ReadonlyMap<string, TokenPrice>;
  /** Unix timestamp (seconds) the aggregation finished. */
  readonly fetchedAt: number;
}

/** One price source. Implementations must be side-effect free mocks for now. */
export interface PriceProvider {
  readonly name: string;
  /**
   * Returns the prices this provider knows about. Symbols it does not cover
   * are simply omitted; only a total failure should reject.
   */
  fetchPrices(req: PriceRequest): Promise<ReadonlyMap<string, TokenPrice>>;
}

/** Machine readable reason a price lookup failed. */
export type OracleErrorCode = 'NO_PROVIDER' | 'ALL_FAILED' | 'SYMBOL_NOT_FOUND';

/** Raised for every price lookup failure, always carrying an {@link OracleErrorCode}. */
export class OracleError extends Error {
  constructor(
    public readonly code: OracleErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OracleError';
  }
}
