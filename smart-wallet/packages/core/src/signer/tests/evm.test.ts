import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { parseTransaction, recoverTransactionAddress } from 'viem';
import { buildTx } from '../../tx-builder';
import { sign, signEvmTx } from '../index';
import { SignerError } from '../types';
import type { UnsignedTx } from '../../tx-builder';

const FROM = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
/** SignInput carries raw bytes, so the generated key is decoded first. */
const keyBytes = (privateKey: `0x${string}`): Uint8Array =>
  Uint8Array.from(Buffer.from(privateKey.slice(2), 'hex'));
const TO = '0x00000000219ab540356cBB839Cbe05303d7705Fa';
const USDC = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

/** Builds an unsigned EVM transaction through the P4 builder. */
async function unsignedNative(): Promise<UnsignedTx> {
  return buildTx(
    {
      family: 'evm',
      chainId: 'ethereum',
      network: 'testnet',
      from: FROM,
      to: TO,
      amount: 1_000_000_000_000_000_000n,
    },
    { nonce: 7n, maxPriorityFeePerGas: 1_500_000_000n },
  );
}

describe('signEvmTx', () => {
  it('signs a native transfer and returns a locally computed hash', async () => {
    const privateKey = keyBytes(generatePrivateKey());
    const account = privateKeyToAccount(`0x${Buffer.from(privateKey).toString('hex')}`);
    const signed = await signEvmTx({ unsignedTx: await unsignedNative(), privateKey });

    expect(signed.family).toBe('evm');
    expect(signed.chainId).toBe('ethereum');
    expect(signed.network).toBe('testnet');
    expect(signed.serialized).toBeInstanceOf(Uint8Array);
    expect((signed.serialized as Uint8Array).length).toBeGreaterThan(0);

    expect(signed.txHash.startsWith('0x')).toBe(true);
    expect(signed.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    // The re-parsed transaction recovers the address of the signing key.
    const serialized = toSerializedHex(signed);
    const recovered = await recoverTransactionAddress({ serializedTransaction: serialized });
    expect(recovered).toBe(account.address);
    expect(signed.meta.from).toBe(account.address);

    const parsed = parseTransaction(serialized);
    expect(parsed.type).toBe('eip1559');
    expect(parsed.nonce).toBe(7);
    expect(parsed.value).toBe(1_000_000_000_000_000_000n);
  });

  it('preserves ERC-20 calldata through signing', async () => {
    const privateKey = keyBytes(generatePrivateKey());
    // Captured up front: the signer wipes the key before it returns.
    const expectedAddress = privateKeyToAccount(
      `0x${Buffer.from(privateKey).toString('hex')}`,
    ).address;
    const unsigned = await buildTx({
      family: 'evm',
      chainId: 'ethereum',
      from: FROM,
      to: TO,
      amount: 2_000_000n,
      token: { address: USDC, decimals: 6 },
    });

    const signed = await signEvmTx({ unsignedTx: unsigned, privateKey });

    expect(signed.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(signed.meta.to).toBe(USDC);

    const serialized = toSerializedHex(signed);
    const parsed = parseTransaction(serialized);
    // 0xa9059cbb is transfer(address,uint256).
    expect(parsed.data?.startsWith('0xa9059cbb')).toBe(true);
    expect(parsed.data).toBe(unsigned.meta.data);

    const recovered = await recoverTransactionAddress({ serializedTransaction: serialized });
    expect(recovered).toBe(expectedAddress);
  });

  it('warns when the key does not match the address the tx was built for', async () => {
    const privateKey = keyBytes(generatePrivateKey());
    const signed = await signEvmTx({ unsignedTx: await unsignedNative(), privateKey });

    expect(signed.meta.warnings).toContain(
      `key signs as ${signed.meta.from} but the transaction was built for ${FROM}`,
    );
  });

  it('is reachable through sign()', async () => {
    const privateKey = keyBytes(generatePrivateKey());
    const signed = await sign({ unsignedTx: await unsignedNative(), privateKey });

    expect(signed.family).toBe('evm');
    expect(signed.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('rejects other families, short keys and non-Uint8Array keys', async () => {
    const privateKey = keyBytes(generatePrivateKey());

    await expect(
      signEvmTx({
        unsignedTx: { ...(await unsignedNative()), family: 'solana' },
        privateKey,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FAMILY' });

    await expect(
      signEvmTx({ unsignedTx: await unsignedNative(), privateKey: new Uint8Array(16) }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // A key with the wrong length is wiped before the error leaves.
    const tooShort = new Uint8Array(16).fill(7);
    await expect(
      signEvmTx({ unsignedTx: await unsignedNative(), privateKey: tooShort }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(tooShort.every((byte) => byte === 0)).toBe(true);

    await expect(
      signEvmTx({
        unsignedTx: await unsignedNative(),
        privateKey: '0x00' as unknown as Uint8Array,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('zeroes the key copy before returning', async () => {
    const privateKey = Uint8Array.from(Buffer.from(generatePrivateKey().slice(2), 'hex'));
    expect(privateKey.some((byte) => byte !== 0)).toBe(true);

    await signEvmTx({ unsignedTx: await unsignedNative(), privateKey });

    expect(privateKey.every((byte) => byte === 0)).toBe(true);
  });

  it('zeroes the key copy when signing throws', async () => {
    const privateKey = keyBytes(generatePrivateKey());

    await expect(
      signEvmTx({ unsignedTx: { ...(await unsignedNative()), family: 'tron' }, privateKey }),
    ).rejects.toThrow(SignerError);

    expect(privateKey.every((byte) => byte === 0)).toBe(true);
  });
});

/** Signed payloads are bytes; viem wants the `0x` hex form back. */
function toSerializedHex(signed: { serialized: Uint8Array | string }): `0x02${string}` {
  const bytes =
    typeof signed.serialized === 'string'
      ? Buffer.from(signed.serialized.replace(/^0x/, ''), 'hex')
      : Buffer.from(signed.serialized);
  return `0x${bytes.toString('hex')}` as `0x02${string}`;
}
