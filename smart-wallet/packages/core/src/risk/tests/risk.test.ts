import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  highestRiskLevel,
  mockChainalysisProvider,
  mockOfacProvider,
  mockTokenWatchProvider,
  riskLevelOrder,
  RiskChecker,
  RiskError,
  type AddressRiskRequest,
  type RiskFlag,
  type RiskLevel,
  type RiskProvider,
  type TokenRiskRequest,
} from '../index';

/** Addresses the mock providers flag, copied from the provider tables. */
const OFAC_EVM = '0x37f53b2d1056e2e07a4aC10AD3B51928cfea0f47';
const OFAC_SOL = 'HejQ5JqYk4Fu8QVsqyQb8Nr8yKPvbzSPNnyHJnm5FAhr';
const MIXER_EVM = '0xc7945533d5A91A739853333d534F4f5801e37730';
const LOW_TRON = 'TVL253MjSUFNrTphcnFGWBeGSAQV8Tat5a';
const CLEAN_EVM = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';

/** All three deterministic mock providers. */
function mockChecker(): RiskChecker {
  return new RiskChecker([mockOfacProvider, mockChainalysisProvider, mockTokenWatchProvider]);
}

/** A provider that answers with a fixed flag list. */
function stubProvider(
  name: string,
  addressFlags: ReadonlyArray<RiskFlag> = [],
  tokenFlags: ReadonlyArray<RiskFlag> = [],
): RiskProvider {
  return {
    name,
    async checkAddress(_req: AddressRiskRequest) {
      return addressFlags;
    },
    async checkToken(_req: TokenRiskRequest) {
      return tokenFlags;
    },
  };
}

/** A provider whose checks always fail, like a screening API outage. */
function brokenProvider(name: string, message: string): RiskProvider {
  return {
    name,
    async checkAddress() {
      throw new Error(message);
    },
    async checkToken() {
      throw new Error(message);
    },
  };
}

/** Builds a flag the way a provider would. */
function makeFlag(level: RiskLevel, reason: string, source: string): RiskFlag {
  return { level, reason, source, detectedAt: Math.floor(Date.now() / 1000) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RiskError', () => {
  it('carries code, name and cause', () => {
    const error = new RiskError('ALL_FAILED', 'everything failed', { tried: 3 });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RiskError);
    expect(error.code).toBe('ALL_FAILED');
    expect(error.name).toBe('RiskError');
    expect(error.message).toBe('everything failed');
    expect(error.cause).toEqual({ tried: 3 });
  });

  it('accepts every documented code', () => {
    const codes = ['NO_PROVIDER', 'ALL_FAILED', 'INVALID_INPUT'] as const;

    for (const code of codes) {
      expect(new RiskError(code, code).code).toBe(code);
    }
  });
});

describe('riskLevelOrder', () => {
  it('orders critical > high > medium > low > none', () => {
    expect(riskLevelOrder('critical')).toBeGreaterThan(riskLevelOrder('high'));
    expect(riskLevelOrder('high')).toBeGreaterThan(riskLevelOrder('medium'));
    expect(riskLevelOrder('medium')).toBeGreaterThan(riskLevelOrder('low'));
    expect(riskLevelOrder('low')).toBeGreaterThan(riskLevelOrder('none'));
    expect(riskLevelOrder('none')).toBe(0);
    expect(riskLevelOrder('critical')).toBe(4);
  });

  it('throws on an unknown level', () => {
    expect(() => riskLevelOrder('extreme' as RiskLevel)).toThrow(/Unknown risk level/);
  });
});

describe('highestRiskLevel', () => {
  it('returns none for an empty list', () => {
    expect(highestRiskLevel([])).toBe('none');
  });

  it('picks the most severe level', () => {
    expect(highestRiskLevel(['low', 'critical', 'medium'])).toBe('critical');
    expect(highestRiskLevel(['medium', 'high', 'low'])).toBe('high');
    expect(highestRiskLevel(['none', 'low'])).toBe('low');
    expect(highestRiskLevel(['none', 'none'])).toBe('none');
  });

  it('does not mutate its input', () => {
    const levels: RiskLevel[] = ['low', 'high'];
    highestRiskLevel(levels);
    expect(levels).toEqual(['low', 'high']);
  });
});

describe('RiskChecker construction and validation', () => {
  it('throws NO_PROVIDER when constructed with an empty array', async () => {
    const checker = new RiskChecker([]);
    const error = await checker.assessAddress({ address: OFAC_EVM }).catch((c: unknown) => c);

    expect(error).toBeInstanceOf(RiskError);
    expect((error as RiskError).code).toBe('NO_PROVIDER');
  });

  it('throws NO_PROVIDER for token assessments too', async () => {
    const checker = new RiskChecker([]);
    const error = await checker.assessToken({ symbol: 'USDT' }).catch((c: unknown) => c);

    expect((error as RiskError).code).toBe('NO_PROVIDER');
  });

  it('throws INVALID_INPUT for an empty address', async () => {
    const checker = mockChecker();
    const error = await checker.assessAddress({ address: '' }).catch((c: unknown) => c);

    expect(error).toBeInstanceOf(RiskError);
    expect((error as RiskError).code).toBe('INVALID_INPUT');
    expect((error as RiskError).message).toContain('address');
  });

  it('throws INVALID_INPUT for a whitespace-only address', async () => {
    const checker = mockChecker();
    const error = await checker.assessAddress({ address: '   \t ' }).catch((c: unknown) => c);

    expect((error as RiskError).code).toBe('INVALID_INPUT');
  });

  it('throws INVALID_INPUT for an empty token symbol', async () => {
    const checker = mockChecker();
    const error = await checker.assessToken({ symbol: '' }).catch((c: unknown) => c);

    expect(error).toBeInstanceOf(RiskError);
    expect((error as RiskError).code).toBe('INVALID_INPUT');
    expect((error as RiskError).message).toContain('symbol');
  });

  it('throws INVALID_INPUT for a whitespace-only token symbol', async () => {
    const checker = mockChecker();
    const error = await checker.assessToken({ symbol: '  ' }).catch((c: unknown) => c);

    expect((error as RiskError).code).toBe('INVALID_INPUT');
  });
});

describe('RiskChecker.assessAddress', () => {
  it('returns none with no flags for a clean address', async () => {
    const result = await mockChecker().assessAddress({ address: CLEAN_EVM });

    expect(result.overallRisk).toBe('none');
    expect(result.flags).toEqual([]);
    expect(Number.isInteger(result.assessedAt)).toBe(true);
  });

  it('flags an OFAC-listed Ethereum address as critical', async () => {
    const result = await mockChecker().assessAddress({ address: OFAC_EVM });

    expect(result.overallRisk).toBe('critical');
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toMatchObject({
      level: 'critical',
      reason: 'Address on OFAC SDN list',
      source: 'mock-ofac',
    });
  });

  it('flags a Chainalysis mixer address as medium', async () => {
    const result = await mockChecker().assessAddress({ address: MIXER_EVM });

    expect(result.overallRisk).toBe('medium');
    expect(result.flags[0]).toMatchObject({
      level: 'medium',
      reason: 'Associated with mixer or high-risk entity',
      source: 'mock-chainalysis',
    });
  });

  it('flags a Solana address from OFAC as high', async () => {
    const result = await mockChecker().assessAddress({
      address: OFAC_SOL,
      chain: 'solana',
    });

    expect(result.overallRisk).toBe('high');
    expect(result.flags[0]).toMatchObject({ level: 'high', source: 'mock-ofac' });
  });

  it('flags a TRON address from Chainalysis as low', async () => {
    const result = await mockChecker().assessAddress({ address: LOW_TRON, chain: 'tron' });

    expect(result.overallRisk).toBe('low');
    expect(result.flags[0]?.reason).toBe('Low-confidence risk signal');
  });

  it('combines flags from several providers and keeps the highest level', async () => {
    // OFAC reports critical, Chainalysis reports medium for the same address.
    const checker = new RiskChecker([
      stubProvider('mock-ofac', [makeFlag('critical', 'Address on OFAC SDN list', 'mock-ofac')]),
      stubProvider('mock-chainalysis', [
        makeFlag('medium', 'Associated with mixer or high-risk entity', 'mock-chainalysis'),
      ]),
    ]);

    const result = await checker.assessAddress({ address: OFAC_EVM });

    expect(result.flags).toHaveLength(2);
    expect(result.overallRisk).toBe('critical');
    expect(result.flags.map((flag) => flag.level)).toEqual(['critical', 'medium']);
  });

  it('sorts flags by risk level descending', async () => {
    const checker = new RiskChecker([
      stubProvider('p-low', [makeFlag('low', 'low signal', 'p-low')]),
      stubProvider('p-critical', [makeFlag('critical', 'critical signal', 'p-critical')]),
      stubProvider('p-medium', [makeFlag('medium', 'medium signal', 'p-medium')]),
      stubProvider('p-high', [makeFlag('high', 'high signal', 'p-high')]),
    ]);

    const result = await checker.assessAddress({ address: 'anything' });

    expect(result.flags.map((flag) => flag.level)).toEqual(['critical', 'high', 'medium', 'low']);
    expect(result.overallRisk).toBe('critical');
  });

  it('deduplicates identical level + reason + source flags', async () => {
    const duplicate = makeFlag('low', 'Low-confidence risk signal', 'mock-chainalysis');
    const checker = new RiskChecker([
      stubProvider('a', [duplicate]),
      stubProvider('b', [duplicate]),
      stubProvider('c', [duplicate]),
    ]);

    const result = await checker.assessAddress({ address: LOW_TRON });

    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]?.reason).toBe('Low-confidence risk signal');
  });

  it('keeps flags that differ only by source', async () => {
    const checker = new RiskChecker([
      stubProvider('a', [makeFlag('low', 'same reason', 'a')]),
      stubProvider('b', [makeFlag('low', 'same reason', 'b')]),
    ]);

    const result = await checker.assessAddress({ address: 'anything' });

    expect(result.flags).toHaveLength(2);
    expect(result.flags.map((flag) => flag.source)).toEqual(['a', 'b']);
  });

  it('forwards the chain hint to the providers', async () => {
    const seen: (string | undefined)[] = [];
    const spy: RiskProvider = {
      name: 'spy',
      async checkAddress(req) {
        seen.push(req.chain);
        return [];
      },
      async checkToken() {
        return [];
      },
    };

    await new RiskChecker([spy]).assessAddress({ address: 'anything', chain: 'ethereum' });

    expect(seen).toEqual(['ethereum']);
  });
});

describe('RiskChecker.assessToken', () => {
  it('returns none for a plain asset like ETH', async () => {
    const result = await mockChecker().assessToken({ symbol: 'ETH' });

    expect(result.overallRisk).toBe('none');
    expect(result.flags).toEqual([]);
  });

  it('flags USDT through Chainalysis with level low', async () => {
    const result = await mockChecker().assessToken({ symbol: 'USDT' });

    expect(result.overallRisk).toBe('low');
    expect(result.flags[0]).toMatchObject({
      level: 'low',
      reason: 'Token has freeze function (heuristic warning)',
      source: 'mock-chainalysis',
    });
  });

  it('flags BUSD through TokenWatch with level medium', async () => {
    const result = await mockChecker().assessToken({ symbol: 'BUSD' });

    expect(result.overallRisk).toBe('medium');
    expect(result.flags[0]).toMatchObject({
      level: 'medium',
      reason: 'Token issuer subject to regulatory action',
      source: 'mock-tokenwatch',
    });
  });

  it('flags DAI through TokenWatch with level low', async () => {
    const result = await mockChecker().assessToken({ symbol: 'DAI' });

    expect(result.overallRisk).toBe('low');
    expect(result.flags[0]?.reason).toBe('Decentralized stablecoin — monitor collateral risk');
  });

  it('matches symbols case-insensitively', async () => {
    const lower = await mockChecker().assessToken({ symbol: 'usdt' });
    const mixed = await mockChecker().assessToken({ symbol: 'bUsd' });

    expect(lower.overallRisk).toBe('low');
    expect(lower.flags[0]?.source).toBe('mock-chainalysis');
    expect(mixed.overallRisk).toBe('medium');
    expect(mixed.flags[0]?.source).toBe('mock-tokenwatch');
  });

  it('combines token flags from several providers', async () => {
    const checker = new RiskChecker([
      stubProvider(
        'mock-chainalysis',
        [],
        [makeFlag('low', 'freeze function', 'mock-chainalysis')],
      ),
      stubProvider('mock-tokenwatch', [], [makeFlag('high', 'issuer action', 'mock-tokenwatch')]),
      stubProvider('mock-ofac', [], []),
    ]);

    const result = await checker.assessToken({ symbol: 'USDT' });

    expect(result.flags).toHaveLength(2);
    expect(result.overallRisk).toBe('high');
    expect(result.flags.map((flag) => flag.level)).toEqual(['high', 'low']);
  });

  it('forwards the chain hint to the providers', async () => {
    const seen: (string | undefined)[] = [];
    const spy: RiskProvider = {
      name: 'spy',
      async checkAddress() {
        return [];
      },
      async checkToken(req) {
        seen.push(req.chain);
        return [];
      },
    };

    await new RiskChecker([spy]).assessToken({ symbol: 'USDC', chain: 'bsc' });

    expect(seen).toEqual(['bsc']);
  });
});

describe('RiskChecker provider failures', () => {
  it('still returns results when one provider throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const checker = new RiskChecker([
      brokenProvider('mock-ofac', 'sanctions feed unreachable'),
      mockChainalysisProvider,
      mockTokenWatchProvider,
    ]);

    const result = await checker.assessAddress({ address: MIXER_EVM });

    expect(result.overallRisk).toBe('medium');
    expect(result.flags[0]?.source).toBe('mock-chainalysis');
  });

  it('still returns token results when one provider throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const checker = new RiskChecker([brokenProvider('broken', 'boom'), mockTokenWatchProvider]);

    const result = await checker.assessToken({ symbol: 'BUSD' });

    expect(result.overallRisk).toBe('medium');
  });

  it('throws ALL_FAILED when every provider throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const checker = new RiskChecker([
      brokenProvider('one', 'timeout'),
      brokenProvider('two', 'rate limited'),
    ]);

    const error = await checker.assessAddress({ address: OFAC_EVM }).catch((c: unknown) => c);

    expect(error).toBeInstanceOf(RiskError);
    expect((error as RiskError).code).toBe('ALL_FAILED');
    expect((error as RiskError).cause).toEqual([
      { provider: 'one', error: expect.any(Error) },
      { provider: 'two', error: expect.any(Error) },
    ]);
  });

  it('does not throw when providers only return empty results', async () => {
    const checker = new RiskChecker([stubProvider('a'), stubProvider('b')]);

    await expect(checker.assessAddress({ address: 'anything' })).resolves.toMatchObject({
      overallRisk: 'none',
      flags: [],
    });
  });

  it('warns on console without throwing when a provider fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const checker = new RiskChecker([
      brokenProvider('mock-ofac', 'feed down'),
      mockTokenWatchProvider,
    ]);

    const result = await checker.assessToken({ symbol: 'BUSD' });

    expect(result.overallRisk).toBe('medium');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('mock-ofac');
    expect(String(warn.mock.calls[0]?.[0])).toContain('feed down');
  });

  it('warns once per failing provider', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const checker = new RiskChecker([
      brokenProvider('one', 'a'),
      brokenProvider('two', 'b'),
      mockTokenWatchProvider,
    ]);

    await checker.assessAddress({ address: 'anything' });

    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain('one');
    expect(String(warn.mock.calls[1]?.[0])).toContain('two');
  });
});

describe('RiskChecker state', () => {
  it('keeps no state between calls', async () => {
    const checker = mockChecker();

    const first = await checker.assessToken({ symbol: 'USDT' });
    const second = await checker.assessToken({ symbol: 'USDT' });

    expect(second.overallRisk).toBe(first.overallRisk);
    expect(second.flags.map((flag) => flag.reason)).toEqual(first.flags.map((flag) => flag.reason));
  });
});
