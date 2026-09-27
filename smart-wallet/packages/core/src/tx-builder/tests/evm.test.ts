import { describe, expect, it } from 'vitest';
import { parseTransaction } from 'viem';
import type { ChainConnector, FeeEstimate } from '@chains';
import { buildEvmTx, buildTx } from '../index';
import { BuilderError } from '../types';

const FROM = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const TO = '0x00000000219ab540356cBB839Cbe05303d7705Fa';
const USDC = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

/** Minimal P3 connector stub that only knows how to price a transaction. */
function fakeConnector(overrides: Partial<FeeEstimate> = {}): ChainConnector {
  const fee: FeeEstimate = {
    chainId: 'ethereum',
    network: 'mainnet',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    units: 21_000n,
    unitPrice: 2_000_000_000n,
    maxCost: 42_000_000_000_000n,
    formattedMaxCost: '0.000042',
    details: { gasLimit: '21000', maxFeePerGas: '2000000000' },
    ...overrides,
  };

  return {
    chainId: 'ethereum',
    network: 'mainnet',
    getNativeBalance: async () => {
      throw new Error('not used by the builder');
    },
    getTokenBalances: async () => [],
    estimateFee: async () => fee,
    broadcast: async () => {
      throw new Error('not used by the builder');
    },
  };
}

const toHex = (serialized: Uint8Array | string): `0x${string}` =>
  typeof serialized === 'string'
    ? (serialized as `0x${string}`)
    : (`0x${Buffer.from(serialized).toString('hex')}` as `0x${string}`);

describe('buildEvmTx', () => {
  it('builds an unsigned native EIP-1559 transaction', async () => {
    const tx = await buildEvmTx({
      family: 'evm',
      chainId: 'ethereum',
      from: FROM,
      to: TO,
      amount: 1_000_000_000_000_000_000n,
    });

    expect(tx.family).toBe('evm');
    expect(tx.chainId).toBe('ethereum');
    expect(tx.network).toBe('mainnet');
    expect(tx.serialized).toBeInstanceOf(Uint8Array);
    expect((tx.serialized as Uint8Array).length).toBeGreaterThan(0);

    // nonce and gas are part of the meta payload.
    expect(tx.meta.nonce).toBe('0');
    expect(tx.meta.gas).toBe('0');
    expect(tx.meta.type).toBe('eip1559');
    expect(tx.meta.warnings).toContain(
      'nonce not supplied: built with nonce 0, fetch the account nonce before signing',
    );

    const parsed = parseTransaction(toHex(tx.serialized));
    expect(parsed.type).toBe('eip1559');
    expect(parsed.chainId).toBe(1);
    expect(parsed.nonce).toBe(0);
    expect(parsed.to?.toLowerCase()).toBe(TO.toLowerCase());
    expect(parsed.value).toBe(1_000_000_000_000_000_000n);
    expect(parsed.data).toBeUndefined();
  });

  it('leaves fee fields at zero without a connector', async () => {
    const tx = await buildEvmTx({
      family: 'evm',
      chainId: 'ethereum',
      from: FROM,
      to: TO,
      amount: 1n,
    });

    expect(tx.fee.maxCost).toBe(0n);
    expect(tx.fee.units).toBe(0n);
    expect(tx.fee.unitPrice).toBe(0n);
    expect(tx.fee.details?.estimated).toBe('false');
    expect(tx.meta.feeEstimated).toBe(false);
  });

  it('prices the transaction through a P3 connector', async () => {
    const tx = await buildEvmTx(
      { family: 'evm', chainId: 'ethereum', from: FROM, to: TO, amount: 5n },
      { connector: fakeConnector(), nonce: 7n, maxPriorityFeePerGas: 1_000_000_000n },
    );

    expect(tx.fee.maxCost).toBe(42_000_000_000_000n);
    expect(tx.meta.gas).toBe('21000');
    expect(tx.meta.nonce).toBe('7');
    expect(tx.meta.maxFeePerGas).toBe('2000000000');
    expect(tx.meta.maxPriorityFeePerGas).toBe('1000000000');
    expect(tx.meta.feeEstimated).toBe(true);

    const parsed = parseTransaction(toHex(tx.serialized));
    expect(parsed.nonce).toBe(7);
    expect(parsed.gas).toBe(21_000n);
    expect(parsed.maxFeePerGas).toBe(2_000_000_000n);
  });

  it('encodes ERC-20 transfer calldata', async () => {
    const tx = await buildEvmTx({
      family: 'evm',
      chainId: 'ethereum',
      network: 'testnet',
      from: FROM,
      to: TO,
      amount: 2_000_000n,
      token: { address: USDC, decimals: 6 },
    });

    // 0xa9059cbb is transfer(address,uint256).
    expect(tx.meta.data).toMatch(/^0xa9059cbb/);
    expect(tx.meta.token).toBe(USDC);

    const parsed = parseTransaction(toHex(tx.serialized));
    expect(parsed.to?.toLowerCase()).toBe(USDC.toLowerCase());
    // A zero value is omitted by RLP, which is exactly what an ERC-20 needs.
    expect(parsed.value ?? 0n).toBe(0n);
    expect(parsed.data).toContain(TO.slice(2).toLowerCase());
    expect(tx.network).toBe('testnet');
  });

  it('refuses to guess a chain id for unknown chains', async () => {
    await expect(
      buildEvmTx({ family: 'evm', chainId: 'my-rollup', from: FROM, to: TO, amount: 1n }),
    ).rejects.toThrow(/unknown numeric chain id for "my-rollup"/);

    const tx = await buildEvmTx(
      { family: 'evm', chainId: 'my-rollup', from: FROM, to: TO, amount: 1n },
      { evmChainId: 4_244 },
    );

    expect(tx.meta.chainId).toBe('4244');
  });

  it('rejects invalid addresses, amounts and decimals', async () => {
    await expect(
      buildEvmTx({
        family: 'evm',
        chainId: 'ethereum',
        from: 'not-an-address',
        to: TO,
        amount: 1n,
      }),
    ).rejects.toThrow(BuilderError);

    await expect(
      buildEvmTx({ family: 'evm', chainId: 'ethereum', from: FROM, to: TO, amount: -1n }),
    ).rejects.toThrow(/must not be negative/);

    await expect(
      buildEvmTx({
        family: 'evm',
        chainId: 'ethereum',
        from: FROM,
        to: TO,
        amount: 1n,
        token: { address: USDC, decimals: 300 },
      }),
    ).rejects.toThrow(/decimals/);
  });

  it('is reachable through buildTx', async () => {
    const tx = await buildTx({
      family: 'evm',
      chainId: 'ethereum',
      from: FROM,
      to: TO,
      amount: 3n,
    });

    expect(tx.family).toBe('evm');
    expect((tx.serialized as Uint8Array).length).toBeGreaterThan(0);
  });
});
