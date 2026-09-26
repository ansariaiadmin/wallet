/**
 * Types shared by the key management package.
 *
 * Everything here is offline: the package derives keys from a BIP-39 phrase,
 * stores them encrypted at rest and signs with the chain's own curve. No
 * method in this package touches the network.
 */

/** Chain families the package can derive keys and sign for. */
export type ChainFamily = 'evm' | 'solana' | 'tron';

/** A derived keypair together with its chain-specific address. */
export interface DerivedKey {
  /** Secret bytes. Callers own the buffer and must zero it when done. */
  readonly privateKey: Uint8Array;
  /** Public bytes: 65-byte SEC1 for secp256k1, 32 bytes for ed25519. */
  readonly publicKey: Uint8Array;
  /** Checksummed EVM address, base58 Solana address or base58check TRON address. */
  readonly address: string;
  /** BIP-44/SLIP-44 path the key was derived at, e.g. `m/44'/60'/0'/0/0`. */
  readonly path: string;
}

/** Which key of an account to derive. */
export interface DeriveOptions {
  /** BIP-44 account index. Default 0. */
  readonly accountIndex?: number;
  /** Address index inside the account. Default 0. */
  readonly addressIndex?: number;
  /** BIP-39 passphrase ("25th word"). Default: none. */
  readonly passphrase?: string;
}

/** Machine readable reason a key operation failed. */
export type KeyStoreErrorCode =
  | 'INVALID_MNEMONIC'
  | 'WRONG_PASSWORD'
  | 'LOCKED'
  | 'UNSUPPORTED_FAMILY'
  | 'DERIVE_FAILED'
  | 'SIGN_FAILED'
  | 'INVALID_INPUT';

/** Raised for every key management failure, always carrying a {@link KeyStoreErrorCode}. */
export class KeyStoreError extends Error {
  constructor(
    message: string,
    public readonly code: KeyStoreErrorCode,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'KeyStoreError';
  }
}

/** Wipes a key buffer in place. Best effort: the caller keeps the reference. */
export function zeroKey(key: Uint8Array): void {
  key.fill(0);
}

/** Wipes a buffer when the value actually is one. */
export function zeroIfBuffer(value: unknown): void {
  if (value instanceof Uint8Array) {
    value.fill(0);
  }
}
