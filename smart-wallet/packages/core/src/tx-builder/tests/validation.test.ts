import { describe, expect, it } from 'vitest';
import { buildTx } from '../index';
import { BuilderError } from '../types';
import type { TxParams } from '../types';

const EVM_BASE = {
  family: 'evm',
  chainId: 'ethereum',
  from: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
  to: '0x00000000219ab540356cBB839Cbe05303d7705Fa',
  amount: 1n,
} as const;

describe('buildTx validation', () => {
  it('rejects an unknown family', async () => {
    const params = { ...EVM_BASE, family: 'dogecoin' } as unknown as TxParams;

    await expect(buildTx(params)).rejects.toThrow(BuilderError);
    await expect(buildTx(params)).rejects.toThrow(/unsupported transaction family: "dogecoin"/);
  });

  it('rejects a missing family', async () => {
    const { family: _family, ...rest } = EVM_BASE;
    const params = rest as unknown as TxParams;

    await expect(buildTx(params)).rejects.toThrow(/unsupported transaction family/);
  });

  it('rejects a negative amount on every family', async () => {
    await expect(buildTx({ ...EVM_BASE, amount: -1n })).rejects.toThrow(/must not be negative/);

    await expect(
      buildTx({
        family: 'solana',
        chainId: 'solana',
        from: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
        to: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        amount: -2n,
      }),
    ).rejects.toThrow(/must not be negative/);

    await expect(
      buildTx({
        family: 'tron',
        chainId: 'tron',
        from: 'TRcvCk5fLxxgRc7KopfPXb3GzUqZMjcKkn',
        to: 'TUjQ4teuAzMbboCGcQqhTc1Wot59fEJnBg',
        amount: -3n,
      }),
    ).rejects.toThrow(/must not be negative/);
  });

  it('rejects amounts that are not bigint', async () => {
    const params = { ...EVM_BASE, amount: 1000 } as unknown as TxParams;

    await expect(buildTx(params)).rejects.toThrow(/amount must be a bigint/);
  });

  it('rejects token decimals outside the u8 range', async () => {
    await expect(
      buildTx({ ...EVM_BASE, token: { address: EVM_BASE.to, decimals: 256 } }),
    ).rejects.toThrow(/decimals/);
  });

  it('rejects a token address that does not match the family', async () => {
    await expect(
      buildTx({ ...EVM_BASE, token: { address: 'not-an-address', decimals: 6 } }),
    ).rejects.toThrow(BuilderError);
  });
});
