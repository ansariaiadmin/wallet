import * as ed25519 from '@noble/ed25519';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { HARDENED_OFFSET } from './paths';

// @noble/ed25519 v3 ships no bundled hashes: install a sync SHA-512 provider
// once, unless another consumer already registered one.
ed25519.hashes.sha512 ??= sha512;

/** Salt for the ed25519 master key, per SLIP-0010. */
const ED25519_SEED_KEY = new TextEncoder().encode('ed25519 seed');

/** One node of an ed25519 SLIP-0010 derivation tree. */
export interface Ed25519Node {
  readonly privateKey: Uint8Array;
  readonly chainCode: Uint8Array;
}

/** Builds the ed25519 master node from a BIP-39 seed (SLIP-0010). */
export function ed25519MasterFromSeed(seed: Uint8Array): Ed25519Node {
  const digest = hmac(sha512, ED25519_SEED_KEY, seed);
  return { privateKey: digest.slice(0, 32), chainCode: digest.slice(32, 64) };
}

/** Derives a hardened child node; ed25519 only supports hardened derivation. */
export function ed25519DeriveChild(parent: Ed25519Node, index: number): Ed25519Node {
  if (index < HARDENED_OFFSET) {
    throw new RangeError('ed25519 derivation supports hardened indices only');
  }
  const data = new Uint8Array(37);
  data[0] = 0x00;
  data.set(parent.privateKey, 1);
  new DataView(data.buffer).setUint32(33, index, false);
  const digest = hmac(sha512, parent.chainCode, data);
  return { privateKey: digest.slice(0, 32), chainCode: digest.slice(32, 64) };
}

/** The 32-byte ed25519 public key for a node. */
export function ed25519PublicKey(node: Ed25519Node): Uint8Array {
  return ed25519.getPublicKey(node.privateKey);
}
