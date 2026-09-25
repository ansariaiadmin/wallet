import { keccak_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';
import type { Hex } from './hex';

/** Address payload size shared by EVM and TRON (20 bytes). */
const ADDRESS_BYTES = 20;
/** TRON mainnet address prefix. */
const TRON_PREFIX = 0x41;
/** base58check trailer size (first 4 bytes of double SHA-256). */
const CHECKSUM_BYTES = 4;

/** EIP-55 checksummed EVM address (`0x` + 40 hex chars) from a public key. */
export function evmAddressFromPublicKey(publicKey: Uint8Array): Hex {
  const hash = keccak_256(withoutCurvePrefix(uncompressed(publicKey)));
  return toEip55Checksum(`0x${bytesToHex(hash.subarray(-ADDRESS_BYTES))}`);
}

/** TRON base58check address (starts with `T`, 34 chars) from a public key. */
export function tronAddressFromPublicKey(publicKey: Uint8Array): string {
  const keyHash = keccak_256(withoutCurvePrefix(uncompressed(publicKey))).subarray(-ADDRESS_BYTES);
  const payload = new Uint8Array(1 + keyHash.length);
  payload[0] = TRON_PREFIX;
  payload.set(keyHash, 1);
  return base58.encode(withBase58Checksum(payload));
}

/** Solana address: base58 of the 32-byte ed25519 public key. */
export function solanaAddressFromPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new RangeError('ed25519 public key must be exactly 32 bytes');
  }
  return base58.encode(publicKey);
}

/** Decodes a TRON base58check address back into its `0x41`-prefixed payload. */
export function decodeTronAddress(address: string): Uint8Array {
  const decoded = base58.decode(address);
  if (decoded.length !== 1 + ADDRESS_BYTES + CHECKSUM_BYTES) {
    throw new RangeError('not a TRON address: wrong decoded length');
  }
  const payload = decoded.subarray(0, 1 + ADDRESS_BYTES);
  const checksum = decoded.subarray(1 + ADDRESS_BYTES);
  const expected = sha256(sha256(payload)).subarray(0, CHECKSUM_BYTES);
  if (!timingSafeEqual(checksum, expected)) {
    throw new RangeError('not a TRON address: base58check checksum mismatch');
  }
  return payload;
}

/** Validates the SEC1 uncompressed form (0x04 || X || Y) used by this module. */
function uncompressed(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new RangeError('expected an uncompressed secp256k1 public key (65 bytes, 0x04 prefix)');
  }
  return publicKey;
}

function withoutCurvePrefix(publicKey: Uint8Array): Uint8Array {
  return publicKey.subarray(1);
}

function withBase58Checksum(payload: Uint8Array): Uint8Array {
  const checksum = sha256(sha256(payload)).subarray(0, CHECKSUM_BYTES);
  const out = new Uint8Array(payload.length + checksum.length);
  out.set(payload, 0);
  out.set(checksum, payload.length);
  return out;
}

function toEip55Checksum(addressHex: string): Hex {
  const body = addressHex.slice(2).toLowerCase();
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(body)));
  let out = '0x';
  for (let i = 0; i < body.length; i += 1) {
    const char = body.charAt(i);
    out += Number.parseInt(hash.charAt(i), 16) >= 8 ? char.toUpperCase() : char;
  }
  return out as Hex;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
