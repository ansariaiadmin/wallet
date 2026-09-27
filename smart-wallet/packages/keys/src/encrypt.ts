/**
 * Encryption at rest: AES-256-GCM with a PBKDF2 key.
 *
 * The key is derived from the caller's secret with a per-blob random salt, so
 * two blobs of the same mnemonic look nothing alike. GCM gives confidentiality
 * and integrity in one pass: a wrong password fails the auth tag check, which
 * is why `decrypt` reports `WRONG_PASSWORD` rather than returning garbage.
 *
 * Node's own `crypto` is used — no new dependency, and the primitives are the
 * audited ones the runtime already ships.
 */

import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { KeyStoreError } from './types.js';

/** PBKDF2 work factor. High enough to be slow to brute force, low enough to unlock. */
export const PBKDF2_ITERATIONS = 250_000;
/** Derived key length: AES-256. */
export const KEY_LENGTH = 32;
/** GCM nonce length. */
export const IV_LENGTH = 12;
/** GCM auth tag length. */
export const TAG_LENGTH = 16;
/** Salt length. */
export const SALT_LENGTH = 32;

/** An encrypted blob: everything needed to decrypt except the secret. */
export interface EncryptedBlob {
  readonly version: 1;
  readonly cipher: 'aes-256-gcm';
  readonly kdf: 'pbkdf2';
  readonly kdfparams: {
    readonly salt: string;
    readonly iterations: number;
    readonly keylen: number;
    readonly digest: 'sha256';
  };
  /** Ciphertext, hex. */
  readonly ciphertext: string;
  /** Nonce, hex, 12 bytes. */
  readonly iv: string;
  /** GCM auth tag, hex, 16 bytes. */
  readonly mac: string;
}

/** Encrypts `plaintext` under `password`. */
export function encrypt(plaintext: Uint8Array, password: string): EncryptedBlob {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    cipher: 'aes-256-gcm',
    kdf: 'pbkdf2',
    kdfparams: {
      salt: salt.toString('hex'),
      iterations: PBKDF2_ITERATIONS,
      keylen: KEY_LENGTH,
      digest: 'sha256',
    },
    ciphertext: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    mac: tag.toString('hex'),
  };
}

/**
 * Decrypts a blob produced by {@link encrypt}.
 *
 * @throws KeyStoreError `WRONG_PASSWORD` when the password is wrong or the
 *   blob was tampered with — GCM cannot tell the two apart, and neither should
 *   the caller.
 */
export function decrypt(blob: EncryptedBlob, password: string): Uint8Array {
  assertBlob(blob);
  const { salt, iterations, keylen, digest } = blob.kdfparams;
  const key = pbkdf2Sync(
    password,
    Buffer.from(salt, 'hex'),
    iterations,
    keylen,
    digest === 'sha256' ? 'sha256' : digest,
  );
  const iv = Buffer.from(blob.iv, 'hex');
  const ciphertext = Buffer.from(blob.ciphertext, 'hex');
  const tag = Buffer.from(blob.mac, 'hex');

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  } catch (error) {
    throw new KeyStoreError('wrong password or corrupted keystore', 'WRONG_PASSWORD', error);
  }
}

/** True when `blob` has the shape this module produces. */
export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const blob = value as Partial<EncryptedBlob>;
  return (
    blob.version === 1 &&
    blob.cipher === 'aes-256-gcm' &&
    blob.kdf === 'pbkdf2' &&
    typeof blob.ciphertext === 'string' &&
    typeof blob.iv === 'string' &&
    typeof blob.mac === 'string' &&
    typeof blob.kdfparams === 'object' &&
    blob.kdfparams !== null
  );
}

/** Rejects a blob that was never produced here, before touching crypto. */
function assertBlob(blob: EncryptedBlob): void {
  if (!isEncryptedBlob(blob)) {
    throw new KeyStoreError('not an encrypted keystore blob', 'WRONG_PASSWORD');
  }
  const { salt, iterations, keylen } = blob.kdfparams;
  if (Buffer.from(salt, 'hex').length !== SALT_LENGTH) {
    throw new KeyStoreError('keystore salt has the wrong length', 'WRONG_PASSWORD');
  }
  if (Buffer.from(blob.iv, 'hex').length !== IV_LENGTH) {
    throw new KeyStoreError('keystore iv has the wrong length', 'WRONG_PASSWORD');
  }
  if (Buffer.from(blob.mac, 'hex').length !== TAG_LENGTH) {
    throw new KeyStoreError('keystore auth tag has the wrong length', 'WRONG_PASSWORD');
  }
  if (!Number.isSafeInteger(iterations) || iterations <= 0 || keylen !== KEY_LENGTH) {
    throw new KeyStoreError('keystore kdf parameters are unusable', 'WRONG_PASSWORD');
  }
}

/** Constant-time comparison, exported for callers that verify tags themselves. */
export function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
