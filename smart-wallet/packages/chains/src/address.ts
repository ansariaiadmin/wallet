import { sha256 } from '@noble/hashes/sha2.js';
import { base58 } from '@scure/base';
import { InvalidAddressError } from './errors';

/** `0x` + 40 hex chars. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** True when `address` is a well-formed EVM address. */
export function isEvmAddress(address: string): boolean {
  return EVM_ADDRESS.test(address);
}

/** True when `address` decodes as a 32-byte base58 Solana public key. */
export function isSolanaAddress(address: string): boolean {
  try {
    return base58.decode(address).length === 32;
  } catch {
    return false;
  }
}

/** True when `address` is a TRON base58check address (`T…`). */
export function isTronAddress(address: string): boolean {
  try {
    tronToHex(address);
    return true;
  } catch {
    return false;
  }
}

/** TRON address prefix byte shared by mainnet and testnets. */
const TRON_PREFIX = 0x41;

/** Converts a TRON base58check address to its 21-byte `0x41…` hex form. */
export function tronToHex(address: string): string {
  let decoded: Uint8Array;
  try {
    decoded = base58.decode(address);
  } catch {
    throw new InvalidAddressError('tron', address);
  }
  if (decoded.length !== 25 || decoded[0] !== TRON_PREFIX) {
    throw new InvalidAddressError('tron', address);
  }
  const payload = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21);
  if (!equalBytes(checksum, doubleSha256(payload).subarray(0, 4))) {
    throw new InvalidAddressError('tron', address);
  }
  return `0x${toHexString(payload)}`;
}

/** Converts a 21-byte `0x41…` hex address back to base58check. */
export function tronFromHex(hexAddress: string): string {
  const normalized = hexAddress.toLowerCase().replace(/^0x/, '');
  if (!/^41[0-9a-f]{40}$/.test(normalized)) {
    throw new InvalidAddressError('tron', hexAddress);
  }
  const payload = Uint8Array.from(Buffer.from(normalized, 'hex'));
  return base58.encode(withChecksum(payload));
}

function withChecksum(payload: Uint8Array): Uint8Array {
  const checksum = doubleSha256(payload).subarray(0, 4);
  const out = new Uint8Array(payload.length + 4);
  out.set(payload, 0);
  out.set(checksum, payload.length);
  return out;
}

function doubleSha256(payload: Uint8Array): Uint8Array {
  return sha256(sha256(payload));
}

function toHexString(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
