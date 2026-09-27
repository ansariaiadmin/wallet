import { WalletError } from '../errors';
import type { UnsignedTx } from '../tx-builder';

/** Machine readable reason a signing attempt failed. */
export type SignerErrorCode = 'UNSUPPORTED_FAMILY' | 'SIGN_FAILED' | 'INVALID_INPUT';

/** Raised for every signing failure, always carrying a {@link SignerErrorCode}. */
export class SignerError extends WalletError {
  constructor(
    readonly code: SignerErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Everything a signer needs.
 *
 * ## Key lifecycle
 *
 * The caller (P2 `unlockWallet`) owns the `DerivedKey` lifecycle and passes a
 * **copy** of the secret bytes here. Every signer copies nothing and stores
 * nothing: it signs inside a `try` block and zeroes the buffer with `fill(0)`
 * in a `finally` block, so the bytes are wiped before the promise resolves or
 * rejects — including on failure. The original key held by the caller is
 * untouched and must still be destroyed by its owner.
 */
export interface SignInput {
  /** Unsigned transaction produced by the P4 builder. */
  readonly unsignedTx: UnsignedTx;
  /** Copy of the secret key; zeroed by the signer before it returns. */
  readonly privateKey: Uint8Array;
}

/** A signed transaction, ready to be handed to the P3 connectors. */
export interface SignedTx {
  readonly family: string;
  readonly chainId: string;
  readonly network: string;
  /** Signed payload: bytes for EVM and Solana, JSON bytes for TRON. */
  readonly serialized: Uint8Array | string;
  /** Locally computed transaction hash (no network call). */
  readonly txHash: string;
  /** Family specific extras: recovered signer, signature, warnings, … */
  readonly meta: Record<string, unknown>;
}

/** Wipes a key buffer in place. */
export function zeroKey(key: Uint8Array): void {
  key.fill(0);
}

/** Wipes a key buffer when the value actually is one. */
export function zeroIfBuffer(value: unknown): void {
  if (value instanceof Uint8Array) {
    value.fill(0);
  }
}

/** Validates the secret buffer and its expected length(s). */
export function requirePrivateKey(
  privateKey: Uint8Array | undefined,
  lengths: readonly number[],
  family: string,
): Uint8Array {
  if (!(privateKey instanceof Uint8Array)) {
    throw new SignerError('INVALID_INPUT', `${family} signing requires a Uint8Array private key`);
  }
  if (privateKey.length === 0) {
    throw new SignerError('INVALID_INPUT', `${family} signing requires a non-empty private key`);
  }
  if (!lengths.includes(privateKey.length)) {
    // Even a key we refuse to use is wiped before the error leaves.
    zeroKey(privateKey);
    const received = privateKey.length;
    throw new SignerError(
      'INVALID_INPUT',
      `${family} signing requires a ${lengths.join(' or ')} byte key, received ${received}`,
    );
  }
  return privateKey;
}

/** Validates the unsigned transaction and returns its family. */
export function requireUnsignedTx(unsignedTx: UnsignedTx | undefined): string {
  if (typeof unsignedTx !== 'object' || unsignedTx === null) {
    throw new SignerError('INVALID_INPUT', 'sign() requires an unsignedTx produced by buildTx()');
  }
  if (typeof unsignedTx.family !== 'string' || unsignedTx.family === '') {
    throw new SignerError('UNSUPPORTED_FAMILY', 'unsignedTx.family is missing');
  }
  return unsignedTx.family;
}

/** Reads a string field from the builder meta bag. */
export function metaString(meta: Record<string, unknown> | undefined, key: string): string | null {
  const value = meta?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Normalizes `Uint8Array | string` payloads into `0x`-prefixed hex. */
export function toHexPayload(serialized: Uint8Array | string): `0x${string}` {
  if (typeof serialized === 'string') {
    return (serialized.startsWith('0x') ? serialized : `0x${serialized}`) as `0x${string}`;
  }
  return `0x${Buffer.from(serialized).toString('hex')}` as `0x${string}`;
}

/** Normalizes `Uint8Array | string` payloads into raw bytes. */
export function toBytesPayload(serialized: Uint8Array | string): Uint8Array {
  return typeof serialized === 'string'
    ? Uint8Array.from(Buffer.from(serialized.replace(/^0x/, ''), 'hex'))
    : serialized;
}

/** Turns a thrown value into a `SignerError`, keeping the original as cause. */
export function asSignerError(family: string, error: unknown): SignerError {
  if (error instanceof SignerError) return error;
  return new SignerError(
    'SIGN_FAILED',
    `${family} signing failed: ${(error as Error).message}`,
    error,
  );
}
