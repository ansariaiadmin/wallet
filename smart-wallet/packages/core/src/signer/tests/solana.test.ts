import { describe, expect, it } from 'vitest';
import { Keypair, Transaction } from '@solana/web3.js';
import { base58 } from '@scure/base';
import { buildTx } from '../../tx-builder';
import { sign, signSolanaTx } from '../index';
import type { UnsignedTx } from '../../tx-builder';

const TO = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MINT = 'GHso3DNhbHuRTsrBE1GMxGwvU7HvQPCQDL8cSwZ8vAK3';
const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

/**
 * Generates a keypair and builds an unsigned transaction for its address, so
 * the key really is a required signer of what gets signed.
 */
async function unsignedNativeFor(keypair: Keypair): Promise<UnsignedTx> {
  return buildTx(
    {
      family: 'solana',
      chainId: 'solana',
      network: 'testnet',
      from: keypair.publicKey.toBase58(),
      to: TO,
      amount: 1_500_000_000n,
    },
    { recentBlockhash: BLOCKHASH, lastValidBlockHeight: 100 },
  );
}

describe('signSolanaTx', () => {
  it('signs a native transfer and returns the base58 signature', async () => {
    const keypair = Keypair.generate();
    const signed = await signSolanaTx({
      unsignedTx: await unsignedNativeFor(keypair),
      privateKey: keypair.secretKey,
    });

    expect(signed.family).toBe('solana');
    expect(signed.chainId).toBe('solana');
    expect(signed.network).toBe('testnet');
    expect(signed.serialized).toBeInstanceOf(Uint8Array);
    expect((signed.serialized as Uint8Array).length).toBeGreaterThan(0);

    // The transaction id is the base58 signature.
    expect(typeof signed.txHash).toBe('string');
    expect(signed.txHash.length).toBeGreaterThan(0);
    expect(signed.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
    expect(signed.meta.from).toBe(keypair.publicKey.toBase58());

    // The payload carries a valid signature for the rebuilt transaction.
    const rebuilt = Transaction.from(signed.serialized as Uint8Array);
    expect(rebuilt.verifySignatures()).toBe(true);
    expect(rebuilt.instructions).toHaveLength(1);
    expect(base58.encode(rebuilt.signatures[0]?.signature ?? new Uint8Array())).toBe(signed.txHash);
  });

  it('signs an SPL transfer with the 32-byte seed form', async () => {
    const keypair = Keypair.generate();
    const unsigned = await buildTx(
      {
        family: 'solana',
        chainId: 'solana',
        from: keypair.publicKey.toBase58(),
        to: TO,
        amount: 2_500_000n,
        token: { mint: MINT, decimals: 6 },
      },
      { recentBlockhash: BLOCKHASH, lastValidBlockHeight: 100 },
    );

    const signed = await signSolanaTx({
      unsignedTx: unsigned,
      // 32-byte ed25519 seed, as returned by the P2 keystore.
      privateKey: keypair.secretKey.subarray(0, 32),
    });

    expect(signed.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(Transaction.from(signed.serialized as Uint8Array).verifySignatures()).toBe(true);
    expect(signed.meta.from).toBe(keypair.publicKey.toBase58());
  });

  it('refuses a key that is not a required signer', async () => {
    const keypair = Keypair.generate();
    const wrong = Keypair.generate();

    await expect(
      signSolanaTx({ unsignedTx: await unsignedNativeFor(keypair), privateKey: wrong.secretKey }),
    ).rejects.toMatchObject({ code: 'SIGN_FAILED' });
  });

  it('is reachable through sign()', async () => {
    const keypair = Keypair.generate();
    const signed = await sign({
      unsignedTx: await unsignedNativeFor(keypair),
      privateKey: keypair.secretKey,
    });

    expect(signed.family).toBe('solana');
    expect(Transaction.from(signed.serialized as Uint8Array).verifySignatures()).toBe(true);
  });

  it('rejects other families and malformed keys', async () => {
    const keypair = Keypair.generate();

    await expect(
      signSolanaTx({
        unsignedTx: { ...(await unsignedNativeFor(keypair)), family: 'evm' },
        privateKey: keypair.secretKey,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FAMILY' });

    await expect(
      signSolanaTx({
        unsignedTx: await unsignedNativeFor(keypair),
        privateKey: new Uint8Array(31),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await expect(
      signSolanaTx({ unsignedTx: await unsignedNativeFor(keypair), privateKey: new Uint8Array(0) }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('zeroes the key copy before returning and when throwing', async () => {
    const keypair = Keypair.generate();
    const seed = keypair.secretKey.subarray(0, 32);
    expect(seed.some((byte) => byte !== 0)).toBe(true);

    await signSolanaTx({ unsignedTx: await unsignedNativeFor(keypair), privateKey: seed });
    expect(seed.every((byte) => byte === 0)).toBe(true);

    // `Keypair.secretKey` hands out a fresh copy on every read, which is
    // exactly the copy the signer is expected to wipe.
    const other = Keypair.generate();
    const otherKey = other.secretKey;
    await expect(
      signSolanaTx({
        unsignedTx: { ...(await unsignedNativeFor(other)), family: 'tron' },
        privateKey: otherKey,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FAMILY' });
    expect(otherKey.every((byte) => byte === 0)).toBe(true);
  });
});
