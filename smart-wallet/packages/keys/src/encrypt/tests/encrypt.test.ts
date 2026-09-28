import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, isEncryptedBlob, safeEqual } from '../../encrypt';
import { KeyStoreError } from '../../types';

const PASSWORD = 'correct horse battery staple';
const SECRET = new TextEncoder().encode(
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
);

describe('encrypt', () => {
  it('describes the scheme in the blob', () => {
    const blob = encrypt(SECRET, PASSWORD);

    expect(blob.version).toBe(1);
    expect(blob.cipher).toBe('aes-256-gcm');
    expect(blob.kdf).toBe('pbkdf2');
    expect(blob.kdfparams.iterations).toBe(250_000);
    expect(blob.kdfparams.keylen).toBe(32);
    expect(blob.kdfparams.digest).toBe('sha256');
  });

  it('uses hex fields of the documented sizes', () => {
    const blob = encrypt(SECRET, PASSWORD);

    expect(blob.kdfparams.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(blob.iv).toMatch(/^[0-9a-f]{24}$/); // 12 bytes
    expect(blob.mac).toMatch(/^[0-9a-f]{32}$/); // 16 bytes
    expect(blob.ciphertext).toMatch(/^[0-9a-f]+$/);
  });

  it('never stores the plaintext', () => {
    const blob = encrypt(SECRET, PASSWORD);

    expect(blob.ciphertext).not.toContain('abandon');
    expect(JSON.stringify(blob)).not.toContain('abandon');
  });

  it('produces a different salt, iv and ciphertext every call', () => {
    const first = encrypt(SECRET, PASSWORD);
    const second = encrypt(SECRET, PASSWORD);

    expect(first.kdfparams.salt).not.toBe(second.kdfparams.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });
});

describe('decrypt', () => {
  it('round-trips the plaintext', () => {
    const blob = encrypt(SECRET, PASSWORD);
    const plain = decrypt(blob, PASSWORD);

    expect(Buffer.from(plain).toString('utf8')).toBe(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    );
  });

  it('round-trips an empty payload', () => {
    const blob = encrypt(new Uint8Array(), PASSWORD);

    expect(decrypt(blob, PASSWORD)).toHaveLength(0);
  });

  it('round-trips binary payloads byte for byte', () => {
    const bytes = Uint8Array.from([0, 1, 254, 255, 128, 7]);
    const blob = encrypt(bytes, PASSWORD);

    expect(decrypt(blob, PASSWORD)).toEqual(bytes);
  });

  it('rejects a wrong password with WRONG_PASSWORD', () => {
    const blob = encrypt(SECRET, PASSWORD);

    try {
      decrypt(blob, 'another password');
      expect.unreachable('decrypt should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(KeyStoreError);
      expect((error as KeyStoreError).code).toBe('WRONG_PASSWORD');
    }
  });

  it('rejects a tampered ciphertext', () => {
    const blob = encrypt(SECRET, PASSWORD);
    const tampered = { ...blob, ciphertext: `ff${blob.ciphertext.slice(2)}` };

    expect(() => decrypt(tampered, PASSWORD)).toThrow(KeyStoreError);
  });

  it('rejects a tampered auth tag', () => {
    const blob = encrypt(SECRET, PASSWORD);
    const tampered = { ...blob, mac: `00${blob.mac.slice(2)}` };

    expect(() => decrypt(tampered, PASSWORD)).toThrow(KeyStoreError);
  });

  it('rejects a blob with the wrong salt length', () => {
    const blob = encrypt(SECRET, PASSWORD);
    const broken = { ...blob, kdfparams: { ...blob.kdfparams, salt: 'abcd' } };

    expect(() => decrypt(broken, PASSWORD)).toThrow(KeyStoreError);
  });

  it('rejects a blob with the wrong iv length', () => {
    const blob = encrypt(SECRET, PASSWORD);
    const broken = { ...blob, iv: 'abcd' };

    expect(() => decrypt(broken, PASSWORD)).toThrow(KeyStoreError);
  });

  it('rejects a blob with unusable kdf parameters', () => {
    const blob = encrypt(SECRET, PASSWORD);
    const broken = { ...blob, kdfparams: { ...blob.kdfparams, iterations: 0 } };

    expect(() => decrypt(broken, PASSWORD)).toThrow(KeyStoreError);
  });

  it('rejects something that is not a blob at all', () => {
    expect(() => decrypt({ version: 2 } as never, PASSWORD)).toThrow(KeyStoreError);
    expect(() => decrypt(null as never, PASSWORD)).toThrow(KeyStoreError);
  });
});

describe('isEncryptedBlob', () => {
  it('accepts what encrypt produced', () => {
    expect(isEncryptedBlob(encrypt(SECRET, PASSWORD))).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isEncryptedBlob(null)).toBe(false);
    expect(isEncryptedBlob('blob')).toBe(false);
    expect(isEncryptedBlob({ version: 1 })).toBe(false);
    expect(isEncryptedBlob({ ...encrypt(SECRET, PASSWORD), cipher: 'aes-128-cbc' })).toBe(false);
  });
});

describe('safeEqual', () => {
  it('compares equal buffers', () => {
    expect(safeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it('rejects different buffers and different lengths', () => {
    expect(safeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(safeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});
