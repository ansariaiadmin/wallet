/**
 * Solana signing on ed25519, through `@solana/web3.js`.
 *
 * The library signs in-process: `Transaction.sign` runs `tweetnacl` locally and
 * no connection is created, so nothing here can reach the cluster. The key
 * bytes are copied on the way in and the copy is wiped by `destroy()`.
 */

import { Keypair, VersionedTransaction, type PublicKey, type Transaction } from '@solana/web3.js';
import { KeyStoreError, zeroIfBuffer } from '../types.js';

/** A signer for one ed25519 key. */
export interface SolanaSigner {
  /** The signer's public key. */
  readonly publicKey: PublicKey;
  /** Base58 address of {@link SolanaSigner.publicKey}. */
  readonly address: string;
  /** Signs a transaction in place and returns it. */
  signTransaction(
    tx: Transaction | VersionedTransaction,
  ): Promise<Transaction | VersionedTransaction>;
}

/**
 * Builds a Solana signer from raw key bytes.
 *
 * 64 bytes are read as a full secret key, 32 bytes as an ed25519 seed — the
 * shape SLIP-0010 derivation produces.
 */
export function createSolanaSigner(privateKey: Uint8Array): SolanaSigner & { destroy(): void } {
  const key = requireKey(privateKey);
  const keypair = keypairFrom(key);

  return {
    publicKey: keypair.publicKey,
    address: keypair.publicKey.toBase58(),
    async signTransaction(
      tx: Transaction | VersionedTransaction,
    ): Promise<Transaction | VersionedTransaction> {
      if (tx instanceof VersionedTransaction) {
        tx.sign([keypair]);
        return tx;
      }
      tx.sign(keypair);
      return tx;
    },
    destroy(): void {
      zeroIfBuffer(key);
    },
  };
}

/** Builds a keypair from a 32-byte seed or a 64-byte secret key. */
export function keypairFrom(privateKey: Uint8Array): Keypair {
  if (privateKey.length === 64) {
    return Keypair.fromSecretKey(privateKey);
  }
  if (privateKey.length === 32) {
    return Keypair.fromSeed(privateKey);
  }
  throw new KeyStoreError(
    `solana signing requires a 32 or 64 byte key, received ${privateKey.length}`,
    'INVALID_INPUT',
  );
}

/** Validates and copies the key bytes. */
function requireKey(privateKey: Uint8Array): Uint8Array {
  if (!(privateKey instanceof Uint8Array)) {
    throw new KeyStoreError('solana signing requires a Uint8Array private key', 'INVALID_INPUT');
  }
  if (privateKey.length !== 32 && privateKey.length !== 64) {
    throw new KeyStoreError(
      `solana signing requires a 32 or 64 byte key, received ${privateKey.length}`,
      'INVALID_INPUT',
    );
  }
  return Uint8Array.from(privateKey);
}
