import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createSolanaSigner, keypairFrom } from '../../src/signers/solana';
import { deriveSolana } from '../../src/derive';
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
const RECIPIENT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const BLOCKHASH = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';

/** A simple transfer the given key is the fee payer of. */
function transfer(key: Uint8Array): Transaction {
  const signer = createSolanaSigner(key);
  const tx = new Transaction({
    feePayer: signer.publicKey,
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 1,
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: RECIPIENT,
      lamports: 1_500_000_000n,
    }),
  );
  return tx;
}

describe('createSolanaSigner', () => {
  it('exposes the public key and address of the seed', () => {
    const key = deriveSolana(TEST_MNEMONIC);
    const signer = createSolanaSigner(key.privateKey);

    expect(signer.address).toBe(key.address);
    expect(signer.publicKey.toBase58()).toBe(key.address);
    signer.destroy();
  });

  it('accepts a 64 byte secret key as well as a seed', () => {
    const seed = deriveSolana(TEST_MNEMONIC).privateKey;
    const secret = Keypair.fromSeed(seed).secretKey;

    expect(createSolanaSigner(secret).address).toBe(createSolanaSigner(seed).address);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => createSolanaSigner(new Uint8Array(31))).toThrow(KeyStoreError);
    expect(() => createSolanaSigner(new Uint8Array(65))).toThrow(KeyStoreError);
  });

  it('rejects a value that is not a Uint8Array', () => {
    expect(() => createSolanaSigner('seed' as never)).toThrow(KeyStoreError);
  });
});

describe('keypairFrom', () => {
  it('builds a keypair from a 32 byte seed', () => {
    const key = deriveSolana(TEST_MNEMONIC);

    expect(keypairFrom(key.privateKey).publicKey.toBase58()).toBe(key.address);
  });

  it('builds a keypair from a 64 byte secret key', () => {
    const seed = deriveSolana(TEST_MNEMONIC).privateKey;
    const secret = Keypair.fromSeed(seed).secretKey;

    expect(keypairFrom(secret).publicKey.toBase58()).toBe(keypairFrom(seed).publicKey.toBase58());
  });
});

describe('signTransaction', () => {
  it('signs a legacy transaction and the signature verifies', async () => {
    const tx = transfer(deriveSolana(TEST_MNEMONIC).privateKey);
    const signer = createSolanaSigner(deriveSolana(TEST_MNEMONIC).privateKey);

    const signed = (await signer.signTransaction(tx)) as Transaction;

    expect(signed.verifySignatures()).toBe(true);
    expect(signed.signatures).toHaveLength(1);
    expect(signed.signatures[0]?.signature).not.toBeNull();
    expect(signed.signatures[0]?.signature).toHaveLength(64);
    signer.destroy();
  });

  it('serializes with every signature present', async () => {
    const tx = transfer(deriveSolana(TEST_MNEMONIC).privateKey);
    const signer = createSolanaSigner(deriveSolana(TEST_MNEMONIC).privateKey);

    const signed = (await signer.signTransaction(tx)) as Transaction;
    const bytes = signed.serialize({ requireAllSignatures: true });

    expect(bytes.length).toBeGreaterThan(100);
    expect(Transaction.from(bytes).verifySignatures()).toBe(true);
    signer.destroy();
  });

  it('leaves the fee payer as the signer', async () => {
    const tx = transfer(deriveSolana(TEST_MNEMONIC).privateKey);
    const signer = createSolanaSigner(deriveSolana(TEST_MNEMONIC).privateKey);

    const signed = (await signer.signTransaction(tx)) as Transaction;

    expect(signed.feePayer?.toBase58()).toBe(signer.address);
    signer.destroy();
  });

  it('produces a different signature for a different key', async () => {
    const one = createSolanaSigner(deriveSolana(TEST_MNEMONIC).privateKey);
    const two = createSolanaSigner(deriveSolana(OTHER_MNEMONIC).privateKey);

    const signedOne = (await one.signTransaction(
      transfer(deriveSolana(TEST_MNEMONIC).privateKey),
    )) as Transaction;
    const signedTwo = (await two.signTransaction(
      transfer(deriveSolana(OTHER_MNEMONIC).privateKey),
    )) as Transaction;

    expect(signedOne.signatures[0]?.signature).not.toEqual(signedTwo.signatures[0]?.signature);
    expect(signedOne.verifySignatures()).toBe(true);
    expect(signedTwo.verifySignatures()).toBe(true);
    one.destroy();
    two.destroy();
  });
});
