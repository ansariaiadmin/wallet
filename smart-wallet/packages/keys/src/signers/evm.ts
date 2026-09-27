/**
 * EVM signing on secp256k1, through viem's local account implementation.
 *
 * `privateKeyToAccount` signs with `@noble/curves` in-process: there is no
 * JSON-RPC call, no `eth_sendTransaction` and no key ever leaving this module.
 * The key buffer handed to {@link createEvmSigner} is copied, zeroed in a
 * `finally` block and never stored on the signer object.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { privateKeyToAccount } from 'viem/accounts';
import type { TransactionRequest, TransactionSerializable } from 'viem';
import { KeyStoreError, zeroIfBuffer } from '../types.js';

/**
 * A transaction request this signer accepts.
 *
 * viem's `TransactionRequest` has no `chainId` in its types, but a signable
 * transaction needs one, so it is added here.
 */
export type EvmTxRequest = TransactionRequest & { chainId?: number };

/** EIP-712 typed data, named the way viem types it. */
export interface EvmTypedData {
  readonly domain: Record<string, unknown>;
  readonly types: Record<string, readonly { name: string; type: string }[]>;
  readonly primaryType: string;
  readonly message: Record<string, unknown>;
}

/** The raw secp256k1 parts of an EVM signature. */
export interface EvmSignatureParts {
  /** Recovery id: `0` or `1` (add 27 for the legacy `v`). */
  readonly v: number;
  readonly r: `0x${string}`;
  readonly s: `0x${string}`;
}

/** A signer for one EVM key. */
export interface EvmSigner {
  /** EIP-55 checksummed address the key controls. */
  readonly address: `0x${string}`;
  /** Signs a transaction and returns the signed RLP as `0x` hex. */
  signTransaction(tx: EvmTxRequest): Promise<`0x${string}`>;
  /** Signs a message with the EIP-191 personal prefix (`personal_sign`). */
  signMessage(message: string | Uint8Array): Promise<`0x${string}`>;
  /** Signs EIP-712 typed data (`eth_signTypedData`). */
  signTypedData(typedData: EvmTypedData): Promise<`0x${string}`>;
  /** Signs a 32 byte digest and returns the raw secp256k1 parts. */
  signRaw(digest: Uint8Array): Promise<EvmSignatureParts>;
  /** Wipes the copy of the key. */
  destroy(): void;
}

/** Expected length of a secp256k1 private key. */
const KEY_BYTES = 32;
/** Expected length of a digest to sign. */
const DIGEST_BYTES = 32;

/**
 * Builds an EVM signer from raw key bytes.
 *
 * The signer keeps a copy of the key, so the caller may zero its own buffer
 * immediately; the copy is wiped when {@link EvmSigner.destroy} is called.
 */
export function createEvmSigner(privateKey: Uint8Array): EvmSigner & { destroy(): void } {
  const key = requireKey(privateKey);
  const account = privateKeyToAccount(toHex(key));

  return {
    address: account.address,
    async signTransaction(tx: EvmTxRequest): Promise<`0x${string}`> {
      // viem's account wants the serializable form; the caller hands us a
      // request and every field is forwarded untouched.
      return account.signTransaction(tx as unknown as TransactionSerializable);
    },
    async signMessage(message: string | Uint8Array): Promise<`0x${string}`> {
      // Raw bytes become `{ raw }` so the EIP-191 personal prefix still wraps
      // them the way a string message is wrapped.
      const signable = typeof message === 'string' ? message : { raw: toHex(message) };
      return account.signMessage({ message: signable });
    },
    async signTypedData(typedData: EvmTypedData): Promise<`0x${string}`> {
      return account.signTypedData(typedData as never);
    },
    async signRaw(digest: Uint8Array): Promise<EvmSignatureParts> {
      if (!(digest instanceof Uint8Array) || digest.length !== DIGEST_BYTES) {
        throw new KeyStoreError(
          `an EVM signature needs a ${DIGEST_BYTES} byte digest, received ${
            digest instanceof Uint8Array ? digest.length : typeof digest
          }`,
          'INVALID_INPUT',
        );
      }
      // `format: 'recovered'` gives the 65 byte [recovery, r, s] layout.
      const signature = secp256k1.sign(digest, key, { format: 'recovered' });
      return {
        v: signature[0] ?? 0,
        r: toHex(signature.subarray(1, 33)),
        s: toHex(signature.subarray(33, 65)),
      };
    },
    destroy(): void {
      zeroIfBuffer(key);
    },
  };
}

/** Validates and copies the key bytes. */
function requireKey(privateKey: Uint8Array): Uint8Array {
  if (!(privateKey instanceof Uint8Array)) {
    throw new KeyStoreError('evm signing requires a Uint8Array private key', 'INVALID_INPUT');
  }
  if (privateKey.length !== KEY_BYTES) {
    throw new KeyStoreError(
      `evm signing requires a ${KEY_BYTES} byte key, received ${privateKey.length}`,
      'INVALID_INPUT',
    );
  }
  return Uint8Array.from(privateKey);
}

/** `0x`-prefixed hex for a byte buffer. */
export function toHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(bytes).toString('hex')}` as `0x${string}`;
}
