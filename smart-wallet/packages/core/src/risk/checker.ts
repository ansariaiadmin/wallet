import { highestRiskLevel, riskLevelOrder } from './level-order';
import type {
  AddressRiskRequest,
  RiskAssessment,
  RiskFlag,
  RiskProvider,
  TokenRiskRequest,
} from './types';
import { RiskError } from './types';

/**
 * Heuristic risk checker — for informational purposes only.
 * Does NOT provide legal advice or real-time sanctions compliance.
 * Results depend on provider data quality and may be incomplete.
 */
export class RiskChecker {
  private readonly providers: RiskProvider[];

  constructor(providers: RiskProvider[]) {
    this.providers = providers;
  }

  /**
   * Screens an address against every provider in parallel.
   *
   * @throws RiskError `NO_PROVIDER` when no provider was configured,
   *   `INVALID_INPUT` for an empty or whitespace-only address, and
   *   `ALL_FAILED` when every provider threw.
   */
  async assessAddress(req: AddressRiskRequest): Promise<RiskAssessment> {
    this.requireProviders();
    const address = this.requireText(req?.address, 'address');
    return this.assess((provider) => provider.checkAddress({ address, chain: req.chain }));
  }

  /**
   * Screens a token symbol against every provider in parallel.
   *
   * @throws RiskError `NO_PROVIDER` when no provider was configured,
   *   `INVALID_INPUT` for an empty or whitespace-only symbol, and
   *   `ALL_FAILED` when every provider threw.
   */
  async assessToken(req: TokenRiskRequest): Promise<RiskAssessment> {
    this.requireProviders();
    const symbol = this.requireText(req?.symbol, 'symbol');
    return this.assess((provider) => provider.checkToken({ symbol, chain: req.chain }));
  }

  /** Runs one query against all providers and merges the flags. */
  private async assess(
    query: (provider: RiskProvider) => Promise<ReadonlyArray<RiskFlag>>,
  ): Promise<RiskAssessment> {
    const settled = await Promise.allSettled(this.providers.map(query));

    const flags: RiskFlag[] = [];
    const failures: { provider: string; error: unknown }[] = [];
    for (const [index, result] of settled.entries()) {
      if (result.status === 'fulfilled') {
        flags.push(...result.value);
        continue;
      }
      // Guarded index read: the settled array always mirrors `providers`.
      const provider = this.providers[index]?.name ?? 'unknown';
      failures.push({ provider, error: result.reason });
      console.warn(
        `risk provider "${provider}" failed and was skipped: ${describeError(result.reason)}`,
      );
    }

    if (failures.length === this.providers.length) {
      throw new RiskError(
        'ALL_FAILED',
        `every risk provider failed (${failures.length} tried)`,
        failures,
      );
    }

    const sorted = dedupeFlags(flags).sort(
      (left, right) => riskLevelOrder(right.level) - riskLevelOrder(left.level),
    );

    return {
      overallRisk: highestRiskLevel(sorted.map((flag) => flag.level)),
      flags: sorted,
      assessedAt: Math.floor(Date.now() / 1000),
    };
  }

  private requireProviders(): void {
    if (this.providers.length === 0) {
      throw new RiskError('NO_PROVIDER', 'no risk provider was configured');
    }
  }

  private requireText(value: string | undefined, field: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new RiskError('INVALID_INPUT', `${field} is required and must not be empty`);
    }
    return value;
  }
}

/** Drops flags that repeat the same (level, reason, source) triple. */
function dedupeFlags(flags: ReadonlyArray<RiskFlag>): RiskFlag[] {
  const seen = new Set<string>();
  const unique: RiskFlag[] = [];
  for (const flag of flags) {
    const key = `${flag.level}|${flag.reason}|${flag.source}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(flag);
  }
  return unique;
}

/** Turns a rejected value into something readable for the warning line. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
