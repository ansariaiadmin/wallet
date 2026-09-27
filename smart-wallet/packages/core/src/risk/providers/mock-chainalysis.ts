import type {
  AddressRiskRequest,
  RiskFlag,
  RiskLevel,
  RiskProvider,
  TokenRiskRequest,
} from '../types';

/** Ethereum addresses linked to mixers or other high-risk entities. */
const MIXER_EVM_ADDRESSES: ReadonlySet<string> = new Set([
  '0xc7945533d5A91A739853333d534F4f5801e37730',
  '0x684493f67aEe4Fdd8E6ef8179ee6B8fa7081b628',
]);

/** TRON address with a weak, low-confidence signal. */
const LOW_CONFIDENCE_TRON_ADDRESSES: ReadonlySet<string> = new Set([
  'TVL253MjSUFNrTphcnFGWBeGSAQV8Tat5a',
]);

/** Builds a flag stamped with the current unix second. */
function flag(level: RiskLevel, reason: string): RiskFlag {
  return { level, reason, source: 'mock-chainalysis', detectedAt: Math.floor(Date.now() / 1000) };
}

/**
 * Deterministic stand-in for a chain-analytics oracle.
 *
 * Address matching is an exact string comparison. Tokens are matched
 * case-insensitively: `USDT` carries a heuristic freeze-function warning on
 * every chain, everything else is left alone.
 */
export const mockChainalysisProvider: RiskProvider = {
  name: 'mock-chainalysis',

  async checkAddress(req: AddressRiskRequest): Promise<ReadonlyArray<RiskFlag>> {
    if (MIXER_EVM_ADDRESSES.has(req.address)) {
      return [flag('medium', 'Associated with mixer or high-risk entity')];
    }
    if (LOW_CONFIDENCE_TRON_ADDRESSES.has(req.address)) {
      return [flag('low', 'Low-confidence risk signal')];
    }
    return [];
  },

  async checkToken(req: TokenRiskRequest): Promise<ReadonlyArray<RiskFlag>> {
    if (req.symbol.trim().toUpperCase() === 'USDT') {
      return [flag('low', 'Token has freeze function (heuristic warning)')];
    }
    return [];
  },
};
