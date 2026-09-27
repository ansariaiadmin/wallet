/**
 * One entry point that signs a builder payload with the right signer.
 *
 * The P4 tx-builder produces a family-tagged `serialized` payload; this module
 * turns that payload into signed bytes with the signer of the family. It is the
 * seam the SDK uses when a `KeyStore` is configured, and it keeps the viem and
 * `@solana/web3.js` imports inside this package.
 */

import { parseTransaction } from 'viem';
import { Transaction } from '@solana/web3.js';
import { KeyStoreError, type ChainFamily } from '../types.js';
import { createEvmSigner, toHex, type EvmTxRequest } from './evm.js';
import { createSolanaSigner } from './solana.js';
import { createTronSigner, type TronRawTx } from './tron.js';

/** The unsigned payload a builder produced, in the shape P4 reports it. */
export interface UnsignedPayload {
  /** Family the payload belongs to. */
  readonly family: ChainFamily;
  /** Hex for EVM, bytes for Solana, JSON bytes for TRON. */
  readonly serialized: Uint8Array | string;
}

/** Signs a builder payload and returns the bytes to broadcast. */
export async function signPayload(
  payload: UnsignedPayload,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  switch (payload.family) {
    case 'evm':
      return signEvmPayload(payload.serialized, privateKey);
    case 'solana':
      return signSolanaPayload(payload.serialized, privateKey);
    case 'tron':
      return signTronPayload(payload.serialized, privateKey);
    default:
      throw new KeyStoreError(
        `unsupported family: ${String(payload.family)}`,
        'UNSUPPORTED_FAMILY',
      );
  }
}

/** Parses an EVM payload back into a transaction request and signs it. */
async function signEvmPayload(
  serialized: Uint8Array | string,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  const signer = createEvmSigner(privateKey);
  try {
    const hex = typeof serialized === 'string' ? serialized : toHex(serialized);
    // A parsed transaction already carries every serializable field.
    const request = parseTransaction(hex as `0x${string}`) as unknown as EvmTxRequest;
    const signed = await signer.signTransaction(request);
    return Uint8Array.from(Buffer.from(signed.slice(2), 'hex'));
  } finally {
    signer.destroy();
  }
}

/** Deserializes a Solana payload, signs it and re-serializes it complete. */
async function signSolanaPayload(
  serialized: Uint8Array | string,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  const signer = createSolanaSigner(privateKey);
  try {
    const bytes =
      typeof serialized === 'string'
        ? Uint8Array.from(Buffer.from(serialized, 'base64'))
        : serialized;
    const transaction = Transaction.from(bytes);
    const signed = await signer.signTransaction(transaction);
    return signed.serialize({ requireAllSignatures: true });
  } finally {
    signer.destroy();
  }
}

/** Parses the TRON envelope, signs it and returns the submission envelope. */
async function signTronPayload(
  serialized: Uint8Array | string,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  const signer = createTronSigner(privateKey);
  try {
    const raw: TronRawTx = parseTron(serialized);
    const signed = await signer.signTransaction(raw);
    return new TextEncoder().encode(JSON.stringify(signed));
  } finally {
    signer.destroy();
  }
}

/** Reads the `{ txID, raw_data, raw_data_hex }` envelope out of a payload. */
export function parseTron(serialized: Uint8Array | string): TronRawTx {
  const text = typeof serialized === 'string' ? serialized : new TextDecoder().decode(serialized);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new KeyStoreError('a TRON payload must be JSON', 'INVALID_INPUT', error);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new KeyStoreError('a TRON payload must be an object', 'INVALID_INPUT');
  }
  const record = parsed as Record<string, unknown>;
  const txID = typeof record.txID === 'string' ? record.txID : '';
  const raw_data_hex = typeof record.raw_data_hex === 'string' ? record.raw_data_hex : undefined;
  if (txID === '' && raw_data_hex === undefined) {
    throw new KeyStoreError('a TRON payload needs txID or raw_data_hex', 'INVALID_INPUT');
  }
  return { txID, raw_data: record.raw_data, raw_data_hex };
}
