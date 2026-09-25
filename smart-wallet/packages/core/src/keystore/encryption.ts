import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { InvalidPasswordError } from './errors';
import { fromHex, toHex, type Hex } from './hex';

/** scrypt cost parameters for the keystore KDF. */
export interface ScryptParams {
  /** CPU/memory cost (must be a power of two). */
  readonly N: number;
  /** Block size factor. */
  readonly r: number;
  /** Parallelization factor. */
  readonly p: number;
  /** Derived key length in bytes. */
  readonly keylen: number;
}

/** Spec-mandated defaults: N=32768, r=8, p=1, 32-byte key. */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 32768, r: 8, p: 1, keylen: 32 };

/** AES-GCM nonce length (96 bits, as recommended for GCM). */
const IV_BYTES = 12;
/** Salt length in bytes. */
const SALT_BYTES = 32;
/** scrypt needs ~32 MiB for the default parameters; leave headroom. */
const MAX_MEM_BYTES = 128 * 1024 * 1024;

/** Ciphertext plus every input needed to decrypt it again. */
export interface EncryptedPayload {
  readonly salt: Hex;
  readonly iv: Hex;
  readonly ciphertext: Hex;
  readonly authTag: Hex;
}

/** Encrypts `plaintext` with AES-256-GCM under a scrypt-derived key. */
export function encryptWithPassword(
  plaintext: Uint8Array,
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): EncryptedPayload {
  if (password.length === 0) {
    throw new TypeError('Password must not be empty');
  }
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(password, salt, params);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      salt: toHex(salt),
      iv: toHex(iv),
      ciphertext: toHex(ciphertext),
      authTag: toHex(cipher.getAuthTag()),
    };
  } finally {
    key.fill(0);
  }
}

/** Decrypts a payload produced by {@link encryptWithPassword}. */
export function decryptWithPassword(
  payload: EncryptedPayload,
  password: string,
  params: ScryptParams,
): Uint8Array {
  const salt = fromHex(payload.salt);
  const iv = fromHex(payload.iv);
  const key = deriveKey(password, salt, params);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(fromHex(payload.authTag));
    return Buffer.concat([decipher.update(fromHex(payload.ciphertext)), decipher.final()]);
  } catch {
    throw new InvalidPasswordError();
  } finally {
    key.fill(0);
  }
}

function deriveKey(password: string, salt: Uint8Array, params: ScryptParams): Buffer {
  return scryptSync(Buffer.from(password, 'utf8'), salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: MAX_MEM_BYTES,
  });
}
