import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createTronSigner, recoverTronAddress, transactionDigest } from '../tron';
import { deriveTron } from '../../derive';
import { KeyStoreError } from '../../types';

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
const OTHER_MNEMONIC = [
  'legal',
  'winner',
  'thank',
  'year',
  'wave',
  'sausage',
  'worth',
  'useful',
  'legal',
  'winner',
  'thank',
  'yellow',
].join(' ');

/** Protobuf-ish raw data for a TRC-20 transfer, as the P4 builder reports it. */
const RAW_DATA = {
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

/** A raw transaction with both `txID` and `raw_data_hex`. */
function rawTx(): { txID: string; raw_data: unknown; raw_data_hex: string } {
  const raw_data_hex = Buffer.from(JSON.stringify(RAW_DATA)).toString('hex');
  return {
    txID: createHash('sha256').update(Buffer.from(raw_data_hex, 'hex')).digest('hex'),
    raw_data: RAW_DATA,
    raw_data_hex,
  };
}

describe('createTronSigner', () => {
  it('exposes the base58check address of the key', () => {
    const key = deriveTron(TEST_MNEMONIC);
    const signer = createTronSigner(key.privateKey);

    expect(signer.address).toBe(key.address);
    expect(signer.address.startsWith('T')).toBe(true);
    expect(signer.address).toHaveLength(34);
    signer.destroy();
  });

  it('rejects a key of the wrong length', () => {
    expect(() => createTronSigner(new Uint8Array(31))).toThrow(KeyStoreError);
  });

  it('rejects a value that is not a Uint8Array', () => {
    expect(() => createTronSigner('key' as never)).toThrow(KeyStoreError);
  });
});

describe('signTransaction', () => {
  it('signs over sha256(raw_data_hex) and returns the envelope', async () => {
    const tx = rawTx();
    const signer = createTronSigner(deriveTron(TEST_MNEMONIC).privateKey);

    const signed = await signer.signTransaction(tx);

    expect(signed.txID).toBe(tx.txID);
    expect(signed.raw_data).toEqual(RAW_DATA);
    expect(signed.signature).toHaveLength(1);
    expect(signed.signature[0]).toMatch(/^[0-9a-f]{130}$/); // 65 bytes
    signer.destroy();
  });

  it('produces a signature that recovers to the signer', async () => {
    const tx = rawTx();
    const signer = createTronSigner(deriveTron(TEST_MNEMONIC).privateKey);

    const signed = await signer.signTransaction(tx);
    const recovered = recoverTronAddress(transactionDigest(tx), signed.signature[0] ?? '');

    expect(recovered).toBe(signer.address);
    signer.destroy();
  });

  it('falls back to the txID when raw_data_hex is absent', async () => {
    const tx = rawTx();
    const signer = createTronSigner(deriveTron(TEST_MNEMONIC).privateKey);

    const signed = await signer.signTransaction({ txID: tx.txID, raw_data: RAW_DATA });
    const recovered = recoverTronAddress(
      Uint8Array.from(Buffer.from(tx.txID, 'hex')),
      signed.signature[0] ?? '',
    );

    expect(recovered).toBe(signer.address);
    signer.destroy();
  });

  it('produces a different signature for a different key', async () => {
    const tx = rawTx();
    const one = createTronSigner(deriveTron(TEST_MNEMONIC).privateKey);
    const two = createTronSigner(deriveTron(OTHER_MNEMONIC).privateKey);

    const first = await one.signTransaction(tx);
    const second = await two.signTransaction(tx);

    expect(first.signature[0]).not.toBe(second.signature[0]);
    expect(recoverTronAddress(transactionDigest(tx), second.signature[0] ?? '')).toBe(two.address);
    one.destroy();
    two.destroy();
  });

  it('rejects a transaction with neither txID nor raw_data_hex', async () => {
    const signer = createTronSigner(deriveTron(TEST_MNEMONIC).privateKey);

    await expect(signer.signTransaction({ txID: '', raw_data: RAW_DATA })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    signer.destroy();
  });

  it('rejects a non-hex raw_data_hex', async () => {
    const signer = createTronSigner(deriveTron(TEST_MNEMONIC).privateKey);

    await expect(
      signer.signTransaction({ ...rawTx(), raw_data_hex: 'zzzz' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    signer.destroy();
  });
});

describe('transactionDigest', () => {
  it('is sha256 of the raw data bytes', () => {
    const tx = rawTx();

    expect(Buffer.from(transactionDigest(tx)).toString('hex')).toBe(tx.txID);
  });

  it('is the txID itself when no hex is given', () => {
    const tx = rawTx();

    expect(
      Buffer.from(transactionDigest({ txID: tx.txID, raw_data: RAW_DATA })).toString('hex'),
    ).toBe(tx.txID);
  });
});

describe('recoverTronAddress', () => {
  it('rejects a signature of the wrong length', () => {
    const tx = rawTx();

    expect(() => recoverTronAddress(transactionDigest(tx), 'abcd')).toThrow(KeyStoreError);
  });
});
