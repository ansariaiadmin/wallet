import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { recoverTransactionAddress } from 'viem';
import { serializeTransaction } from 'viem';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { parseTron, signPayload } from '../../src/signers/payload';
import { deriveEvm, deriveSolana, deriveTron } from '../../src/derive';
import { KeyStoreError } from '../../src/types';

const TEST_MNEMONIC = [
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'about',
].join(' ');
const RECIPIENT = '0x00000000219ab540356cBB839Cbe05303d7705Fa';
const SOL_RECIPIENT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

/** An unsigned EIP-1559 transfer, the way the P4 builder serializes it. */
function evmPayload(): { family: 'evm'; serialized: Uint8Array } {
  const serialized = serializeTransaction({
    chainId: 1,
    nonce: 0,
    gas: 21_000n,
    maxFeePerGas: 40_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
    to: RECIPIENT,
    value: 1_000_000_000_000_000_000n,
    type: 'eip1559',
  });
  return { family: 'evm', serialized: Uint8Array.from(Buffer.from(serialized.slice(2), 'hex')) };
}

/** An unsigned legacy transfer, the way the P4 builder serializes it. */
function evmLegacyPayload(): { family: 'evm'; serialized: Uint8Array } {
  const serialized = serializeTransaction({
    chainId: 1,
    nonce: 0,
    gas: 21_000n,
    gasPrice: 30_000_000_000n,
    to: RECIPIENT,
    value: 1n,
    type: 'legacy',
  });
  return { family: 'evm', serialized: Uint8Array.from(Buffer.from(serialized.slice(2), 'hex')) };
}

/** An unsigned Solana transfer, serialized without signatures. */
function solanaPayload(): { family: 'solana'; serialized: Uint8Array } {
  const key = deriveSolana(TEST_MNEMONIC);
  const keypair = Keypair.fromSeed(key.privateKey);
  const tx = new Transaction({
    feePayer: keypair.publicKey,
    blockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
    lastValidBlockHeight: 1,
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: SOL_RECIPIENT,
      lamports: 1_500_000_000n,
    }),
  );
  return { family: 'solana', serialized: tx.serialize({ requireAllSignatures: false }) };
}

/** An unsigned TRON envelope, the way the P4 builder serializes it. */
function tronPayload(): { family: 'tron'; serialized: Uint8Array } {
  const raw_data = {
    contract: [
      {
        parameter: {
          value: { amount: 25_000_000 },
          type_url: 'type.googleapis.com/protocol.TransferContract',
        },
        type: 'TransferContract',
      },
    ],
    ref_block_bytes: '1f2c',
    ref_block_hash: '9c3b2d1e5f7a8b4c',
    expiration: 1_800_000_000_000,
    timestamp: 1_700_000_000_000,
  };
  const raw_data_hex = Buffer.from(JSON.stringify(raw_data)).toString('hex');
  return {
    family: 'tron',
    serialized: new TextEncoder().encode(
      JSON.stringify({
        txID: createHash('sha256').update(Buffer.from(raw_data_hex, 'hex')).digest('hex'),
        raw_data,
        raw_data_hex,
      }),
    ),
  };
}

describe('signPayload: evm', () => {
  it('signs an EIP-1559 payload into RLP bytes that recover to the signer', async () => {
    const key = deriveEvm(TEST_MNEMONIC);
    const signed = await signPayload(evmPayload(), key.privateKey);

    expect(signed[0]).toBe(0x02);
    const recovered = await recoverTransactionAddress({
      serializedTransaction: `0x${Buffer.from(signed).toString('hex')}` as `0x02${string}`,
    });
    expect(recovered).toBe(key.address);
  });

  it('signs a legacy payload', async () => {
    const key = deriveEvm(TEST_MNEMONIC);
    const signed = await signPayload(evmLegacyPayload(), key.privateKey);

    expect(signed.length).toBeGreaterThan(100);
    const recovered = await recoverTransactionAddress({
      serializedTransaction: `0x${Buffer.from(signed).toString('hex')}` as `0x02${string}`,
    });
    expect(recovered).toBe(key.address);
  });

  it('accepts the payload as hex as well', async () => {
    const key = deriveEvm(TEST_MNEMONIC);
    const payload = evmPayload();
    const hex = `0x${Buffer.from(payload.serialized).toString('hex')}`;

    expect(await signPayload({ family: 'evm', serialized: hex }, key.privateKey)).toEqual(
      await signPayload(payload, key.privateKey),
    );
  });
});

describe('signPayload: solana', () => {
  it('signs the payload and the result verifies', async () => {
    const key = deriveSolana(TEST_MNEMONIC);
    const signed = await signPayload(solanaPayload(), key.privateKey);

    expect(Transaction.from(signed).verifySignatures()).toBe(true);
    expect(Transaction.from(signed).signatures).toHaveLength(1);
  });

  it('keeps the fee payer the signer', async () => {
    const key = deriveSolana(TEST_MNEMONIC);
    const signed = await signPayload(solanaPayload(), key.privateKey);

    expect(Transaction.from(signed).feePayer?.toBase58()).toBe(key.address);
  });
});

describe('signPayload: tron', () => {
  it('signs the envelope and returns a submission envelope', async () => {
    const key = deriveTron(TEST_MNEMONIC);
    const signed = await signPayload(tronPayload(), key.privateKey);
    const envelope = JSON.parse(new TextDecoder().decode(signed)) as {
      signature: string[];
      raw_data_hex: string;
    };

    expect(envelope.signature).toHaveLength(1);
    expect(envelope.signature[0]).toMatch(/^[0-9a-f]{130}$/);
    expect(envelope.raw_data_hex).toMatch(/^[0-9a-f]+$/);
  });

  it('is byte-for-byte reproducible for the same payload and key', async () => {
    const key = deriveTron(TEST_MNEMONIC);

    expect(await signPayload(tronPayload(), key.privateKey)).toEqual(
      await signPayload(tronPayload(), key.privateKey),
    );
  });
});

describe('signPayload: errors', () => {
  it('rejects an unknown family', async () => {
    const key = deriveEvm(TEST_MNEMONIC);

    await expect(
      signPayload({ family: 'dogecoin' as never, serialized: new Uint8Array() }, key.privateKey),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FAMILY' });
  });

  it('rejects a TRON payload that is not JSON', async () => {
    const key = deriveTron(TEST_MNEMONIC);

    await expect(
      signPayload({ family: 'tron', serialized: 'not json' }, key.privateKey),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects an EVM key of the wrong length', async () => {
    await expect(signPayload(evmPayload(), new Uint8Array(31))).rejects.toThrow(KeyStoreError);
  });
});

describe('parseTron', () => {
  it('reads the envelope out of bytes', () => {
    const parsed = parseTron(tronPayload().serialized);

    expect(parsed.txID).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.raw_data_hex).toMatch(/^[0-9a-f]+$/);
    expect(parsed.raw_data).toBeTypeOf('object');
  });

  it('keeps an envelope without raw_data_hex when it has a txID', () => {
    const parsed = parseTron(
      new TextEncoder().encode(JSON.stringify({ txID: 'ab'.repeat(32), raw_data: {} })),
    );

    expect(parsed.raw_data_hex).toBeUndefined();
    expect(parsed.txID).toHaveLength(64);
  });

  it('rejects an envelope with neither field', () => {
    expect(() => parseTron(new TextEncoder().encode('{"raw_data":{}}'))).toThrow(KeyStoreError);
  });
});
