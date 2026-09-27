/**
 * A {@link KeyStore} that keeps its blobs on disk.
 *
 * Every mnemonic is encrypted with the P13 `encrypt` before it is written, so a
 * stolen file is a 250 000-iteration PBKDF2 problem rather than a phrase. The
 * file name comes from a sanitized id, so an id can never escape the directory,
 * and the file is created with owner-only permissions.
 *
 * The interface is the same one `MemoryKeyStore` implements, so callers pick a
 * backend without changing code — in-memory for tests and CLI sessions, this
 * one for anything that must survive a restart.
 */

import { mkdir, readFile, writeFile, unlink, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { decrypt, encrypt, isEncryptedBlob } from '../encrypt.js';
import type { KeyStore } from '../keystore.js';
import { assertValid } from '../mnemonic.js';
import { KeyStoreError } from '../types.js';

/** Ids a file name may safely carry: letters, digits, `_` and `-`. */
const ID_PATTERN = /^[\w-]{1,64}$/;
/** Owner read/write only: the phrase must not be world readable. */
const FILE_MODE = 0o600;

/** A {@link KeyStore} backed by one encrypted file per id. */
export class FileKeyStore implements KeyStore {
  constructor(private readonly dir: string) {}

  /** Encrypts `mnemonic` and writes it to `<dir>/<id>.enc`. */
  async store(id: string, mnemonic: string, passphrase = ''): Promise<void> {
    const path = this.path(id);
    const blob = encrypt(new TextEncoder().encode(assertValid(mnemonic)), passphrase);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(blob), { encoding: 'utf8', mode: FILE_MODE });
  }

  /** Reads and decrypts `<dir>/<id>.enc`. */
  async load(id: string, passphrase = ''): Promise<string> {
    const path = this.path(id);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      throw new KeyStoreError(`no mnemonic stored under "${id}"`, 'NOT_FOUND');
    }
    let blob: unknown;
    try {
      blob = JSON.parse(raw);
    } catch (error) {
      throw new KeyStoreError(`the keystore file for "${id}" is not JSON`, 'INVALID_INPUT', error);
    }
    if (!isEncryptedBlob(blob)) {
      throw new KeyStoreError(`the keystore file for "${id}" is not a blob`, 'INVALID_INPUT');
    }
    const bytes = decrypt(blob, passphrase);
    try {
      return new TextDecoder().decode(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  /** Whether `<dir>/<id>.enc` exists. */
  async has(id: string): Promise<boolean> {
    // The id is checked outside the try, so a bad id is an error and not a
    // silent "not there".
    const path = this.path(id);
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deletes `<dir>/<id>.enc`.
   *
   * Unlike {@link MemoryKeyStore.remove}, a missing entry is an error here: the
   * caller asked for a file to disappear and nothing was there to remove.
   */
  async remove(id: string): Promise<void> {
    const path = this.path(id);
    try {
      await unlink(path);
    } catch {
      throw new KeyStoreError(`no mnemonic stored under "${id}"`, 'NOT_FOUND');
    }
  }

  /** Absolute path of the blob for `id`, after checking the id is safe. */
  private path(id: string): string {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw new KeyStoreError(
        `a keystore id may only hold letters, digits, "_" and "-" (1-64 of them), received "${String(id)}"`,
        'INVALID_INPUT',
      );
    }
    return join(this.dir, `${id}.enc`);
  }
}
