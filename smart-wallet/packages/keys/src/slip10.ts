/**
 * SLIP-0010 ed25519 derivation, used for Solana.
 *
 * ed25519 only supports hardened derivation, so every segment of a Solana path
 * carries the hardened bit. The master key is `HMAC-SHA512("ed25519 seed",
 * seed)` and each child is `HMAC-SHA512(chainCode, 0x00 || privateKey ||
 * index)` — exactly what SLIP-0010 specifies, and what the Solana CLI and
 * Phantom produce.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';

/** Salt for the ed25519 master key, per SLIP-0010. */
const MASTER_SECRET = new TextEncoder().encode('ed25519 seed');

/** Hardened offset: index + 0x80000000 marks a hardened child. */
export const HARDENED_OFFSET = 0x80000000;

/** One node of the derivation tree. */
export interface Ed25519Node {
  readonly privateKey: Uint8Array;
  readonly chainCode: Uint8Array;
}

/** Builds the master node from a 64-byte BIP-39 seed. */
export function masterKey(seed: Uint8Array): Ed25519Node {
  const digest = hmac(sha512, MASTER_SECRET, seed);
  return { privateKey: digest.slice(0, 32), chainCode: digest.slice(32, 64) };
}

/** Derives a hardened child node. */
export function childKey(parent: Ed25519Node, index: number): Ed25519Node {
  const hardened = index < HARDENED_OFFSET ? index + HARDENED_OFFSET : index;
  const data = new Uint8Array(37);
  data[0] = 0x00;
  data.set(parent.privateKey, 1);
  new DataView(data.buffer).setUint32(33, hardened, false);
  const digest = hmac(sha512, parent.chainCode, data);
  return { privateKey: digest.slice(0, 32), chainCode: digest.slice(32, 64) };
}

/**
 * Derives the ed25519 private seed at `path`, e.g. `m/44'/501'/0'/0'`.
 *
 * @throws RangeError when a segment is not hardened or is not an index.
 */
export function deriveSolanaKey(seed: Uint8Array, path: string): Uint8Array {
  const segments = parsePath(path);
  let node = masterKey(seed);
  for (const segment of segments) {
    if (!segment.hardened) {
      throw new RangeError(`ed25519 derivation requires hardened segments: ${path}`);
    }
    node = childKey(node, segment.index);
  }
  return node.privateKey;
}

/** Splits a path into absolute indices, keeping the hardened flag. */
export function parsePath(path: string): Array<{ index: number; hardened: boolean }> {
  if (typeof path !== 'string' || !path.startsWith('m')) {
    throw new RangeError(`expected a path like m/44'/501'/0'/0', received ${String(path)}`);
  }
  return path
    .replace(/^m\/?/, '')
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => {
      const hardened = /['hH]$/.test(segment);
      const digits = hardened ? segment.slice(0, -1) : segment;
      if (!/^\d+$/.test(digits)) {
        throw new RangeError(`segment "${segment}" is not an index`);
      }
      const index = Number.parseInt(digits, 10);
      if (index >= HARDENED_OFFSET) {
        throw new RangeError(`segment "${segment}" is out of range`);
      }
      return { index, hardened };
    });
}
