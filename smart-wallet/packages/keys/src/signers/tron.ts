/**
 * TRON signing on secp256k1 with base58check addressing, hand-written on
 * `node:crypto` and `@noble/curves` — no tronweb.
 *
 * TRON signs `sha256(raw_data_hex)` with secp256k1; that digest is also the
 * transaction id, so the signer uses it for both. The signature TRON expects
 * is 65 bytes as `r || s || recovery`. The result is the submission envelope
 * `{ txID, raw_data, signature: [hex] }` a TronGrid node accepts.
 */

import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { KeyStoreError, zeroIfBuffer } from '../types.js';
import { tronAddress } from '../derive.js';

/** An unsigned TRON transaction as the P4 builder produces it. */
export interface TronRawTx {
  /** Transaction id: sha256 of the raw data bytes, hex. */
  txID: string;
  /** The protobuf transaction body, as parsed JSON. */
  raw_data: unknown;
  /** Hex of the protobuf body, when the caller has it. */
  raw_data_hex?: string;
}

/** A signed TRON transaction, ready for `wallet/broadcasttransaction`. */
export interface TronSignedTx {
  txID: string;
  raw_data: unknown;
  /** Hex of the raw data, echoed back when the caller supplied it. */
  raw_data_hex?: string;
  /** One hex signature per required signer; this package produces one. */
  signature: string[];
}

/** A signer for one TRON key. */
export interface TronSigner {
  /** base58check address the key controls, e.g. `T…`. */
  readonly address: string;
  /** Signs a transaction and returns the submission envelope. */
  signTransaction(tx: TronRawTx): Promise<TronSignedTx>;
}

/** Expected length of a secp256k1 private key. */
const KEY_BYTES = 32;
/** Signature length TRON expects: r || s || recovery. */
const SIGNATURE_BYTES = 65;

/** Builds a TRON signer from raw key bytes. */
export function createTronSigner(privateKey: Uint8Array): TronSigner & { destroy(): void } {
  const key = requireKey(privateKey);
  const publicKey = secp256k1.getPublicKey(key, false);
  const address = tronAddress(publicKey);

  return {
    address,
    async signTransaction(tx: TronRawTx): Promise<TronSignedTx> {
      const digest = transactionDigest(tx);

      // `format: 'recovered'` yields the 65 byte [recovery, r, s]; TRON wants
      // r || s || v, so the recovery byte moves to the end.
      const recovered = secp256k1.sign(digest, key, { format: 'recovered' });
      if (!secp256k1.verify(recovered, digest, publicKey, { format: 'recovered' })) {
        throw new KeyStoreError('the produced signature does not verify', 'SIGN_FAILED');
      }

      const signature = new Uint8Array(SIGNATURE_BYTES);
      signature.set(recovered.subarray(1), 0);
      signature[SIGNATURE_BYTES - 1] = recovered[0] ?? 0;

      const signatureHex = Buffer.from(signature).toString('hex');
      return {
        txID: tx.txID,
        raw_data: tx.raw_data,
        // The node can rebuild it, but echoing it back keeps the envelope
        // self-contained for a caller that forwards it untouched.
        ...(typeof tx.raw_data_hex === 'string' && tx.raw_data_hex !== ''
          ? { raw_data_hex: tx.raw_data_hex }
          : {}),
        signature: [signatureHex],
      };
    },
    destroy(): void {
      zeroIfBuffer(key);
    },
  };
}

/**
 * The digest a transaction is signed over.
 *
 * `raw_data_hex` is the protobuf body and takes precedence; without it the
 * `txID` is used, because on TRON the id *is* that digest.
 */
export function transactionDigest(tx: TronRawTx): Uint8Array {
  if (typeof tx?.raw_data_hex === 'string' && tx.raw_data_hex !== '') {
    if (!/^[0-9a-fA-F]+$/.test(tx.raw_data_hex)) {
      throw new KeyStoreError('raw_data_hex must be hex', 'INVALID_INPUT');
    }
    return createHash('sha256').update(Buffer.from(tx.raw_data_hex, 'hex')).digest();
  }
  if (typeof tx?.txID !== 'string' || !/^[0-9a-fA-F]{64}$/.test(tx.txID)) {
    throw new KeyStoreError('a TRON transaction needs txID or raw_data_hex', 'INVALID_INPUT');
  }
  return Uint8Array.from(Buffer.from(tx.txID, 'hex'));
}

/** Recovers the signer address from a signature produced by {@link createTronSigner}. */
export function recoverTronAddress(digest: Uint8Array, signatureHex: string): string {
  const signature = Uint8Array.from(Buffer.from(signatureHex, 'hex'));
  if (signature.length !== SIGNATURE_BYTES) {
    throw new KeyStoreError(
      `a TRON signature is ${SIGNATURE_BYTES} bytes, received ${signature.length}`,
      'INVALID_INPUT',
    );
  }
  const recovered = new Uint8Array(SIGNATURE_BYTES);
  recovered.set(signature.subarray(0, 64), 1);
  recovered[0] = signature[64] ?? 0;
  // A 65-byte, recovery-first signature is what `recoverPublicKey` expects.
  const publicKey = secp256k1.recoverPublicKey(recovered, digest);
  return tronAddress(publicKey);
}

/** Validates and copies the key bytes. */
function requireKey(privateKey: Uint8Array): Uint8Array {
  if (!(privateKey instanceof Uint8Array)) {
    throw new KeyStoreError('tron signing requires a Uint8Array private key', 'INVALID_INPUT');
  }
  if (privateKey.length !== KEY_BYTES) {
    throw new KeyStoreError(
      `tron signing requires a ${KEY_BYTES} byte key, received ${privateKey.length}`,
      'INVALID_INPUT',
    );
  }
  return Uint8Array.from(privateKey);
}
