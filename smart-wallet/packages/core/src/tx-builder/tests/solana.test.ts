import { describe, expect, it } from 'vitest';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import type { ChainConnector, FeeEstimate } from '@chains';
import { buildSolanaTx, buildTx } from '../index';
import { BuilderError } from '../types';

const FROM = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const TO = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MINT = 'GHso3DNhbHuRTsrBE1GMxGwvU7HvQPCQDL8cSwZ8vAK3';
const OWNER_ATA = 'CtcDkuLxYjP9mY1SjGLCzQBhgrXoUv6nUqMTRvxWY7Pn';

const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM_PROGRAM_ID = SystemProgram.programId.toBase58();

function fakeConnector(overrides: Partial<FeeEstimate> = {}): ChainConnector {
  const fee: FeeEstimate = {
    chainId: 'solana',
    network: 'testnet',
    nativeSymbol: 'SOL',
    nativeDecimals: 9,
    units: 1n,
    unitPrice: 5_000n,
    maxCost: 5_000n,
    formattedMaxCost: '0.000005',
    ...overrides,
  };

  return {
    chainId: 'solana',
    network: 'testnet',
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

const deserialize = (serialized: Uint8Array | string): Transaction =>
  Transaction.from(
    typeof serialized === 'string' ? Buffer.from(serialized, 'base64') : Buffer.from(serialized),
  );

describe('buildSolanaTx', () => {
  it('builds an unsigned native SOL transfer', async () => {
    const tx = await buildSolanaTx({
      family: 'solana',
      chainId: 'solana',
      network: 'testnet',
      from: FROM,
      to: TO,
      amount: 1_500_000_000n,
    });

    expect(tx.family).toBe('solana');
    expect(tx.chainId).toBe('solana');
    expect(tx.network).toBe('testnet');
    expect(tx.serialized).toBeInstanceOf(Uint8Array);

    const transaction = deserialize(tx.serialized);
    expect(transaction.instructions).toHaveLength(1);
    expect(transaction.instructions[0]?.programId.toBase58()).toBe(SYSTEM_PROGRAM_ID);
    expect(transaction.feePayer?.toBase58()).toBe(FROM);
    expect(tx.meta.programId).toBe(SYSTEM_PROGRAM_ID);
    expect(tx.meta.amount).toBe('1500000000');
  });

  it('warns when no recent blockhash is supplied', async () => {
    const tx = await buildSolanaTx({
      family: 'solana',
      chainId: 'solana',
      from: FROM,
      to: TO,
      amount: 1n,
    });

    expect(tx.meta.recentBlockhash).toBe('11111111111111111111111111111111');
    expect(tx.meta.warnings).toContain(
      'recent blockhash not supplied: built with a placeholder, fetch a real one before signing',
    );
    expect(tx.fee.maxCost).toBe(0n);
  });

  it('uses a supplied blockhash and connector fee', async () => {
    const tx = await buildSolanaTx(
      { family: 'solana', chainId: 'solana', from: FROM, to: TO, amount: 10n },
      {
        connector: fakeConnector(),
        recentBlockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
        lastValidBlockHeight: 123,
      },
    );

    expect(tx.meta.recentBlockhash).toBe('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N');
    expect(tx.meta.lastValidBlockHeight).toBe('123');
    expect(tx.meta.feeEstimated).toBe(true);
    expect(tx.fee.maxCost).toBe(5_000n);

    const transaction = deserialize(tx.serialized);
    expect(transaction.recentBlockhash).toBe('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N');
  });

  it('fetches a blockhash through the injected provider', async () => {
    const tx = await buildSolanaTx(
      { family: 'solana', chainId: 'solana', from: FROM, to: TO, amount: 10n },
      {
        blockhashProvider: async () => ({
          blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
          lastValidBlockHeight: 42,
        }),
      },
    );

    expect(tx.meta.recentBlockhash).toBe('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N');
    expect(tx.meta.lastValidBlockHeight).toBe('42');
    expect(tx.meta.warnings).not.toContain(
      'recent blockhash not supplied: built with a placeholder, fetch a real one before signing',
    );
  });

  it('builds an unsigned SPL transfer with derived associated token accounts', async () => {
    const tx = await buildSolanaTx({
      family: 'solana',
      chainId: 'solana',
      from: FROM,
      to: TO,
      amount: 2_500_000n,
      token: { mint: MINT, decimals: 6 },
    });

    const transaction = deserialize(tx.serialized);
    expect(transaction.instructions).toHaveLength(1);

    const instruction = transaction.instructions[0];
    expect(instruction?.programId.toBase58()).toBe(SPL_TOKEN_PROGRAM_ID);
    expect(instruction?.keys).toHaveLength(4);
    // owner must sign, the token accounts and the mint must not.
    expect(instruction?.keys.map((key) => key.isSigner)).toEqual([false, false, false, true]);

    // TransferChecked payload: discriminator 12, u64 amount, decimals byte.
    const data = Buffer.from(instruction?.data ?? []);
    expect(data[0]).toBe(12);
    expect(data.readBigUInt64LE(1)).toBe(2_500_000n);
    expect(data[9]).toBe(6);

    expect(tx.meta.programId).toBe(SPL_TOKEN_PROGRAM_ID);
    expect(tx.meta.mint).toBe(MINT);
    expect(tx.meta.ataDerived).toBe(true);
    expect(tx.meta.sourceAta).toBe(deriveAta(FROM, MINT));
    expect(tx.meta.destinationAta).toBe(deriveAta(TO, MINT));
  });

  it('honours a caller supplied owner token account', async () => {
    const tx = await buildSolanaTx({
      family: 'solana',
      chainId: 'solana',
      from: FROM,
      to: TO,
      amount: 1n,
      token: { mint: MINT, decimals: 6, ownerAta: OWNER_ATA },
    });

    expect(tx.meta.sourceAta).toBe(OWNER_ATA);
    expect(tx.meta.ataDerived).toBe(false);
    expect(tx.meta.destinationAta).toBe(deriveAta(TO, MINT));
  });

  it('rejects invalid addresses, amounts and decimals', async () => {
    await expect(
      buildSolanaTx({
        family: 'solana',
        chainId: 'solana',
        from: 'not-base58!',
        to: TO,
        amount: 1n,
      }),
    ).rejects.toThrow(BuilderError);

    await expect(
      buildSolanaTx({ family: 'solana', chainId: 'solana', from: FROM, to: TO, amount: -5n }),
    ).rejects.toThrow(/must not be negative/);

    await expect(
      buildSolanaTx({
        family: 'solana',
        chainId: 'solana',
        from: FROM,
        to: TO,
        amount: 18_446_744_073_709_551_616n,
      }),
    ).rejects.toThrow(/u64/);

    await expect(
      buildSolanaTx({
        family: 'solana',
        chainId: 'solana',
        from: FROM,
        to: TO,
        amount: 1n,
        token: { mint: MINT, decimals: 6.5 },
      }),
    ).rejects.toThrow(/decimals/);
  });

  it('is reachable through buildTx', async () => {
    const tx = await buildTx({
      family: 'solana',
      chainId: 'solana',
      from: FROM,
      to: TO,
      amount: 7n,
    });

    expect(tx.family).toBe('solana');
    expect(deserialize(tx.serialized).instructions).toHaveLength(1);
  });
});

/** Local mirror of the ATA derivation, used to assert the builder's output. */
function deriveAta(owner: string, mint: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBuffer(),
      new PublicKey(SPL_TOKEN_PROGRAM_ID).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  );
  return ata.toBase58();
}
