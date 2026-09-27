/**
 * Screening verdicts with a short-lived cache in front of the P8 checker.
 *
 * A sanctions check fans out to every provider, and a verdict does not change
 * from one request to the next. The wrapper keeps the assessment for
 * {@link RISK_CACHE_TTL_MS} per `address:network` (and per token symbol), so a
 * repeated screen is answered without touching a provider.
 *
 * Failures are never cached: a provider outage must not be remembered as a
 * verdict.
 */

import type { AddressRiskRequest, RiskAssessment, TokenRiskRequest } from '../risk/index.js';
import type { RiskChecker } from '../risk/index.js';
import type { CacheOptions, CacheStats } from './types';
import { CacheStore } from './store';

/** How long a screening verdict stays fresh. */
export const RISK_CACHE_TTL_MS = 60_000;

/** What a {@link CachedRiskAssessor} accepts on top of {@link CacheOptions}. */
export interface CachedRiskOptions extends CacheOptions {
  /** Store to use; defaults to a fresh one per instance. */
  readonly store?: CacheStore<string, RiskAssessment>;
}

export class CachedRiskAssessor {
  private readonly checker: RiskChecker;
  private readonly ttlMs: number;
  private readonly store: CacheStore<string, RiskAssessment>;

  constructor(checker: RiskChecker, options: CachedRiskOptions = {}) {
    this.checker = checker;
    this.ttlMs = options.ttlMs ?? RISK_CACHE_TTL_MS;
    this.store = options.store ?? new CacheStore<string, RiskAssessment>();
  }

  /** Cached address screen. Key: `address:network`. */
  async assessAddress(req: AddressRiskRequest): Promise<RiskAssessment> {
    const key = addressKey(req.address, req.chain);
    const cached = this.store.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const assessment = await this.checker.assessAddress(req);
    this.store.set(key, assessment, this.ttlMs);
    return assessment;
  }

  /** Cached token screen. Key: `token:symbol:network`. */
  async assessToken(req: TokenRiskRequest): Promise<RiskAssessment> {
    const key = tokenKey(req.symbol, req.chain);
    const cached = this.store.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const assessment = await this.checker.assessToken(req);
    this.store.set(key, assessment, this.ttlMs);
    return assessment;
  }

  /** Drops every cached verdict. */
  clearCache(): void {
    this.store.clear();
  }

  /** Hits, misses and the number of cached verdicts. */
  cacheStats(): CacheStats {
    return this.store.stats();
  }
}

/** Cache key for one address on one network. */
export function addressKey(address: string, network?: string): string {
  const normalized = typeof address === 'string' ? address.trim() : '';
  return `${normalized}:${(network ?? 'unknown').trim().toLowerCase()}`;
}

/** Cache key for one token symbol on one network. */
export function tokenKey(symbol: string, network?: string): string {
  const normalized = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
  return `token:${normalized}:${(network ?? 'unknown').trim().toLowerCase()}`;
}
