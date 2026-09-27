/** Ordered risk levels, from "nothing to see here" to "do not touch". */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** One reason an address or token looks risky. */
export interface RiskFlag {
  level: RiskLevel;
  /** Human readable explanation, e.g. "Address on OFAC SDN list". */
  reason: string;
  /** Provider or list that produced the flag. */
  source: string;
  /** Unix timestamp (seconds) the flag was produced. */
  detectedAt: number;
}

/** What the caller wants screened. */
export interface AddressRiskRequest {
  address: string;
  /** Optional chain hint, e.g. `ethereum`, `solana` or `tron`. */
  chain?: string;
}

/** What the caller wants screened. */
export interface TokenRiskRequest {
  symbol: string;
  /** Optional chain hint, e.g. `ethereum` or `bsc`. */
  chain?: string;
}

/** The merged verdict for one request. */
export interface RiskAssessment {
  /** Highest level across all flags; `none` when nothing was flagged. */
  overallRisk: RiskLevel;
  /** Deduplicated flags, sorted by level descending. */
  flags: ReadonlyArray<RiskFlag>;
  /** Unix timestamp (seconds) the assessment finished. */
  assessedAt: number;
}

/** One screening source. Implementations are deterministic mocks for now. */
export interface RiskProvider {
  readonly name: string;
  /** Returns the flags for `req`; an empty array means "nothing found". */
  checkAddress(req: AddressRiskRequest): Promise<ReadonlyArray<RiskFlag>>;
  /** Returns the flags for `req`; an empty array means "nothing found". */
  checkToken(req: TokenRiskRequest): Promise<ReadonlyArray<RiskFlag>>;
}

/** Machine readable reason a screening request failed. */
export type RiskErrorCode = 'NO_PROVIDER' | 'ALL_FAILED' | 'INVALID_INPUT';

/** Raised for every screening failure, always carrying a {@link RiskErrorCode}. */
export class RiskError extends Error {
  constructor(
    public readonly code: RiskErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RiskError';
  }
}
