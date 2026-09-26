/**
 * BIP-44 derivation per chain family.
 *
 * secp256k1 chains (EVM, TRON) go through BIP-32 (`@scure/bip32`); Solana goes
 * through SLIP-0010 ed25519, which only supports hardened derivation. Addresses
 * are produced here rather than by a chain library, so the package stays
 * dependency-light and every address is reproducible from the phrase alone.
 */

import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58, base58check } from '@scure/base';
import { deriveSolanaKey, HARDENED_OFFSET } from './slip10.js';
import { toSeed } from './mnemonic.js';
import { KeyStoreError, type ChainFamily, type DerivedKey, type DeriveOptions } from './types.js';

/** BIP-44 purpose, hardened. */
const PURPOSE = 44;
/** SLIP-44 coin types. */
const COIN_TYPES = { evm: 60, tron: 195, solana: 501 } as const;
/** Address payload size shared by EVM and TRON. */
const ADDRESS_BYTES = 20;
/** Length of an uncompressed secp256k1 public key. */
const PUBLIC_KEY_BYTES = 65;
/** Length of a compressed secp256k1 public key. */
const COMPRESSED_PUBLIC_KEY_BYTES = 33;
/** TRON mainnet address prefix. */
const TRON_PREFIX = 0x41;

/** The derivation path for one family at one index. */
export function pathFor(family: ChainFamily, options: DeriveOptions = {}): string {
  const account = options.accountIndex ?? 0;
  const index = options.addressIndex ?? 0;
  switch (family) {
    case 'evm':
      return `m/${PURPOSE}'/${COIN_TYPES.evm}'/${account}'/0/${index}`;
    case 'tron':
      return `m/${PURPOSE}'/${COIN_TYPES.tron}'/${account}'/0/${index}`;
    case 'solana':
      return `m/${PURPOSE}'/${COIN_TYPES.solana}'/${index}'/0'`;
    default:
      throw new KeyStoreError(`unsupported family: ${String(family)}`, 'UNSUPPORTED_FAMILY');
  }
}

/**
 * Derives the key for `family` at `path` from a 64-byte seed.
 *
 * @throws KeyStoreError `UNSUPPORTED_FAMILY` for an unknown family and
 *   `DERIVE_FAILED` when the curve refuses the seed.
 */
export function deriveKey(seed: Uint8Array, family: ChainFamily, path: string): DerivedKey {
  if (family === 'evm' || family === 'tron') {
    const node = HDKey.fromMasterSeed(seed).derive(path);
    const privateKey = node.privateKey;
    if (privateKey === null || privateKey === undefined) {
      throw new KeyStoreError(`no private key at ${path}`, 'DERIVE_FAILED');
    }
    const publicKey = secp256k1.getPublicKey(privateKey, false);
    return {
      privateKey,
      publicKey,
      address: family === 'evm' ? evmAddress(publicKey) : tronAddress(publicKey),
      path,
    };
  }

  if (family === 'solana') {
    const privateKey = deriveSolanaKey(seed, path);
    const publicKey = ed25519.getPublicKey(privateKey);
    return { privateKey, publicKey, address: base58.encode(publicKey), path };
  }

  throw new KeyStoreError(`unsupported family: ${String(family)}`, 'UNSUPPORTED_FAMILY');
}

/** Derives an EVM key from a mnemonic. Default path `m/44'/60'/0'/0/0`. */
export function deriveEvm(mnemonic: string, index = 0, options: DeriveOptions = {}): DerivedKey {
  return deriveFromMnemonic(mnemonic, 'evm', index, options);
}

/** Derives a TRON key from a mnemonic. Default path `m/44'/195'/0'/0/0`. */
export function deriveTron(mnemonic: string, index = 0, options: DeriveOptions = {}): DerivedKey {
  return deriveFromMnemonic(mnemonic, 'tron', index, options);
}

/** Derives a Solana key from a mnemonic. Default path `m/44'/501'/0'/0'`. */
export function deriveSolana(mnemonic: string, index = 0, options: DeriveOptions = {}): DerivedKey {
  return deriveFromMnemonic(mnemonic, 'solana', index, options);
}

/** Derives every family from one mnemonic, in a stable order. */
export function deriveAll(
  mnemonic: string,
  index = 0,
  options: DeriveOptions = {},
): Record<ChainFamily, DerivedKey> {
  return {
    evm: deriveEvm(mnemonic, index, options),
    solana: deriveSolana(mnemonic, index, options),
    tron: deriveTron(mnemonic, index, options),
  };
}

/** Shared body of the per-family helpers. */
function deriveFromMnemonic(
  mnemonic: string,
  family: ChainFamily,
  index: number,
  options: DeriveOptions,
): DerivedKey {
  const path = pathFor(family, { ...options, addressIndex: index });
  const seed = toSeed(mnemonic, options.passphrase ?? '');
  return deriveKey(seed, family, path);
}

/** EIP-55 checksummed `0x` address from an uncompressed secp256k1 public key. */
export function evmAddress(uncompressedPublicKey: Uint8Array): string {
  const hash = keccak_256(uncompressedPublicKey.subarray(1));
  const lower = Buffer.from(hash.subarray(-ADDRESS_BYTES)).toString('hex');
  return `0x${toChecksum(lower)}`;
}

/**
 * TRON base58check address (`T…`, 34 chars) from a secp256k1 public key.
 *
 * A compressed key is expanded first, because the address is the keccak of the
 * 64 bytes that follow the `0x04` marker of the uncompressed key.
 */
export function tronAddress(publicKey: Uint8Array): string {
  if (!(publicKey instanceof Uint8Array)) {
    throw new KeyStoreError('a TRON address needs a Uint8Array public key', 'UNSUPPORTED_FAMILY');
  }
  let uncompressed = publicKey;
  if (uncompressed.length === COMPRESSED_PUBLIC_KEY_BYTES) {
    uncompressed = secp256k1.Point.fromBytes(uncompressed).toBytes(false);
  }
  if (uncompressed.length !== PUBLIC_KEY_BYTES || uncompressed[0] !== 0x04) {
    throw new KeyStoreError(
      `a TRON address needs an uncompressed secp256k1 key, received ${publicKey.length}`,
      'UNSUPPORTED_FAMILY',
    );
  }
  const keyHash = keccak_256(uncompressed.subarray(1)).subarray(-ADDRESS_BYTES);
  const payload = new Uint8Array(1 + keyHash.length);
  payload[0] = TRON_PREFIX;
  payload.set(keyHash, 1);
  return base58check(sha256).encode(payload);
}

/** Solana base58 address from a 32-byte ed25519 public key. */
export function solanaAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new KeyStoreError('ed25519 public key must be 32 bytes', 'DERIVE_FAILED');
  }
  return base58.encode(publicKey);
}

/** Applies the EIP-55 mixed-case checksum to a lowercase hex address body. */
function toChecksum(lower: string): string {
  const digest = keccak_256(new TextEncoder().encode(lower));
  return [...lower]
    .map((character, position) => {
      const nibble = digest[position >> 1] ?? 0;
      const bit = position % 2 === 0 ? nibble >> 4 : nibble & 0x0f;
      return bit >= 8 ? character.toUpperCase() : character;
    })
    .join('');
}

/** The hardened offset, re-exported so callers can build paths themselves. */
export { HARDENED_OFFSET };
