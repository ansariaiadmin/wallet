import type {
  AddressRiskRequest,
  RiskFlag,
  RiskLevel,
  RiskProvider,
  TokenRiskRequest,
} from '../types';

/** Token-level heuristics: symbol → level and reason. */
const TOKEN_FLAGS: ReadonlyMap<string, { level: RiskLevel; reason: string }> = new Map([
  ['BUSD', { level: 'medium', reason: 'Token issuer subject to regulatory action' }],
  ['DAI', { level: 'low', reason: 'Decentralized stablecoin — monitor collateral risk' }],
]);

/** Builds a flag stamped with the current unix second. */
function flag(level: RiskLevel, reason: string): RiskFlag {
  return { level, reason, source: 'mock-tokenwatch', detectedAt: Math.floor(Date.now() / 1000) };
}

/**
 * Deterministic stand-in for a token-level watchlist.
 *
 * This source only knows about tokens, so {@link checkAddress} always comes
 * back empty. Symbols are upper-cased before the lookup, so `busd`, `BUSD` and
 * `Busd` all match.
 */
export const mockTokenWatchProvider: RiskProvider = {
  name: 'mock-tokenwatch',

  async checkAddress(_req: AddressRiskRequest): Promise<ReadonlyArray<RiskFlag>> {
    return [];
  },

  async checkToken(req: TokenRiskRequest): Promise<ReadonlyArray<RiskFlag>> {
    // Guarded lookup: unknown symbols are simply not flagged.
    const entry = TOKEN_FLAGS.get(req.symbol.trim().toUpperCase());
    if (entry === undefined) {
      return [];
    }
    return [flag(entry.level, entry.reason)];
  },
};
