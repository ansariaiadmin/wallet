/**
 * Mnemonic storage.
 *
 * A {@link KeyStore} keeps recovery phrases encrypted at rest and hands them
 * back on demand. The interface is deliberately async and id-keyed so the same
 * code serves an in-memory store (tests, CLI sessions) and a real one (a file
 * or OS keychain) without the callers changing.
 *
 * The shipped implementation, {@link MemoryKeyStore}, never touches the file
 * system: it holds AES-256-GCM blobs in a map for the lifetime of the process.
 */

import { decrypt, encrypt, type EncryptedBlob } from './encrypt.js';
import { assertValid } from './mnemonic.js';
import { KeyStoreError } from './types.js';

/** Storage for recovery phrases, keyed by an opaque id. */
export interface KeyStore {
  /** Encrypts and stores `mnemonic` under `id`, replacing anything there. */
  store(id: string, mnemonic: string, passphrase?: string): Promise<void>;
  /** Decrypts and returns the mnemonic stored under `id`. */
  load(id: string, passphrase?: string): Promise<string>;
  /** Whether `id` holds a mnemonic. */
  has(id: string): Promise<boolean>;
  /** Forgets `id`. */
  remove(id: string): Promise<void>;
}

/**
 * In-memory {@link KeyStore}.
 *
 * The phrase is validated on the way in and encrypted with a per-entry random
 * salt before it is stored, so the plaintext never sits in the map. With no
 * passphrase the blob is still encrypted — PBKDF2 over an empty secret — which
 * keeps the phrase out of a heap dump but not out of reach of someone holding
 * the process; pass a passphrase for anything that matters.
 */
export class MemoryKeyStore implements KeyStore {
  private readonly entries = new Map<string, EncryptedBlob>();

  /** Validates the phrase, then stores its encrypted form under `id`. */
  async store(id: string, mnemonic: string, passphrase = ''): Promise<void> {
    requireId(id);
    const normalized = assertValid(mnemonic);
    this.entries.set(id, encrypt(new TextEncoder().encode(normalized), passphrase));
  }

  /** Decrypts the phrase stored under `id`. */
  async load(id: string, passphrase = ''): Promise<string> {
    const blob = this.entries.get(requireId(id));
    if (blob === undefined) {
      throw new KeyStoreError(`no mnemonic stored under "${id}"`, 'LOCKED');
    }
    const bytes = decrypt(blob, passphrase);
    try {
      return new TextDecoder().decode(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  /** Whether `id` holds a mnemonic. */
  async has(id: string): Promise<boolean> {
    return this.entries.has(requireId(id));
  }

  /** Forgets `id`. Silent when nothing was stored there. */
  async remove(id: string): Promise<void> {
    this.entries.delete(requireId(id));
  }

  /** How many mnemonics are stored. */
  get size(): number {
    return this.entries.size;
  }

  /** The ids currently stored, for diagnostics. Never includes key material. */
  ids(): string[] {
    return [...this.entries.keys()];
  }

  /** Forgets everything. */
  clear(): void {
    this.entries.clear();
  }
}

/** Rejects an empty id, which would make every entry unreachable. */
function requireId(id: string): string {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new KeyStoreError('keystore id must be a non-empty string', 'INVALID_INPUT');
  }
  return id;
}
