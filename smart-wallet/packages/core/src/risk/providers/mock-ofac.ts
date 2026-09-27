import type {
  AddressRiskRequest,
  RiskFlag,
  RiskLevel,
  RiskProvider,
  TokenRiskRequest,
} from '../types';

/** Sanctioned Ethereum addresses, all reported as `critical`. */
const SDN_EVM_ADDRESSES: ReadonlySet<string> = new Set([
  '0x37f53b2d1056e2e07a4aC10AD3B51928cfea0f47',
  '0x21585f59AAA50B2A67ec1e690f943dbf302a3Dc6',
  '0xd69cfeFef28d3f161e3818A71275e8B2AC592Fa3',
]);

/** Flagged Solana addresses, all reported as `high`. */
const FLAGGED_SOL_ADDRESSES: ReadonlySet<string> = new Set([
  'HejQ5JqYk4Fu8QVsqyQb8Nr8yKPvbzSPNnyHJnm5FAhr',
  'H5k1w8F4Dxz7xvvmHN9zKPTJtGJ8CuRc2VQWdaXcXLWt',
]);

/** Builds a flag stamped with the current unix second. */
function flag(level: RiskLevel, reason: string): RiskFlag {
  return { level, reason, source: 'mock-ofac', detectedAt: Math.floor(Date.now() / 1000) };
}

/**
 * Deterministic stand-in for an OFAC SDN feed.
 *
 * Address matching is an exact string comparison — no normalization beyond the
 * caller's own input — and the chain hint is ignored, exactly like the real
 * list which is keyed by address only. Tokens are never flagged here.
 */
export const mockOfacProvider: RiskProvider = {
  name: 'mock-ofac',

  async checkAddress(req: AddressRiskRequest): Promise<ReadonlyArray<RiskFlag>> {
    if (SDN_EVM_ADDRESSES.has(req.address)) {
      return [flag('critical', 'Address on OFAC SDN list')];
    }
    if (FLAGGED_SOL_ADDRESSES.has(req.address)) {
      return [flag('high', 'Address flagged by OFAC')];
    }
    return [];
  },

  async checkToken(_req: TokenRiskRequest): Promise<ReadonlyArray<RiskFlag>> {
    return [];
  },
};
