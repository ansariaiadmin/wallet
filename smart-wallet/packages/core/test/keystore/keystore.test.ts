import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createWallet,
  importWallet,
  unlockWallet,
  DEFAULT_SCRYPT_PARAMS,
  type EncryptedKeystore,
} from '@core/keystore/keystore';
import { decodeTronAddress } from '@core/keystore/addresses';
import { DEFAULT_EVM_PATH } from '@core/keystore/paths';
import { deriveFromSeed } from '@core/keystore/hd';
import { mnemonicToSeed } from '@core/keystore/mnemonic';
import type { Hex } from '@core/keystore/hex';
import {
  InvalidMnemonicError,
  InvalidPasswordError,
  KeystoreError,
  MalformedKeystoreError,
  UnsupportedPathError,
} from '@core/keystore/errors';

const PASSWORD = 'correct horse battery staple';
const ABANDON_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function flipLastHexChar(hex: Hex): Hex {
  const last = hex.at(-1);
  const flipped = last === '0' ? '1' : '0';
  return `${hex.slice(0, -1)}${flipped}` as Hex;
}

describe('createWallet', () => {
  it('returns a mnemonic, an encrypted blob and an address', () => {
    const wallet = createWallet(PASSWORD);

    expect(wallet.mnemonic.split(' ')).toHaveLength(12);
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.encrypted.address).toBe(wallet.address);
    expect(wallet.encrypted.path).toBe(DEFAULT_EVM_PATH);
  });

  it('supports 24-word mnemonics', () => {
    const wallet = createWallet(PASSWORD, { strength: 256 });

    expect(wallet.mnemonic.split(' ')).toHaveLength(24);
  });

  it('writes the spec encryption parameters into the blob', () => {
    const { encrypted } = createWallet(PASSWORD);

    expect(encrypted.version).toBe(1);
    expect(encrypted.kdf).toBe('scrypt');
    expect(encrypted.cipher).toBe('aes-256-gcm');
    expect(encrypted.kdfParams).toEqual(DEFAULT_SCRYPT_PARAMS);
    expect(encrypted.kdfParams).toEqual({ N: 32768, r: 8, p: 1, keylen: 32 });
    // 32-byte salt, 12-byte IV, 16-byte auth tag.
    expect(encrypted.salt).toHaveLength(2 + 64);
    expect(encrypted.iv).toHaveLength(2 + 24);
    expect(encrypted.authTag).toHaveLength(2 + 32);
  });

  it('encrypts the 64-byte seed, never the mnemonic', () => {
    const { encrypted } = createWallet(PASSWORD);

    expect(encrypted.ciphertext).toHaveLength(2 + 128);
  });

  it('uses a fresh salt and IV for every encryption', () => {
    const first = createWallet(PASSWORD).encrypted;
    const second = createWallet(PASSWORD).encrypted;

    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('rejects an empty password', () => {
    expect(() => createWallet('')).toThrow(TypeError);
  });

  it('supports custom scrypt parameters', () => {
    const { encrypted } = createWallet(PASSWORD, { kdf: { N: 1024 } });

    expect(encrypted.kdfParams).toEqual({ N: 1024, r: 8, p: 1, keylen: 32 });
    expect(() => unlockWallet(encrypted, PASSWORD)).not.toThrow();
  });
});

describe('importWallet', () => {
  it('restores the same wallet from the same mnemonic', () => {
    const first = importWallet(ABANDON_MNEMONIC, 'password-one');
    const second = importWallet(ABANDON_MNEMONIC, 'password-two');

    expect(first.address).toBe(second.address);
    expect(first.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    // Different passwords must still produce different ciphertexts.
    expect(first.encrypted.ciphertext).not.toBe(second.encrypted.ciphertext);
  });

  it('rejects invalid mnemonics', () => {
    expect(() => importWallet('abandon abandon abandon', PASSWORD)).toThrow(InvalidMnemonicError);
    expect(() => importWallet('', PASSWORD)).toThrow(InvalidMnemonicError);
  });

  it('accepts a BIP-39 passphrase', () => {
    const plain = importWallet(ABANDON_MNEMONIC, PASSWORD);
    const withPassphrase = importWallet(ABANDON_MNEMONIC, PASSWORD, { passphrase: 'extra' });

    expect(withPassphrase.address).not.toBe(plain.address);
  });
});

describe('unlockWallet', () => {
  it('round-trips: generate → encrypt → decrypt → derive', () => {
    const created = createWallet(PASSWORD);
    const wallet = unlockWallet(created.encrypted, PASSWORD);

    expect(wallet.address).toBe(created.address);
    expect(wallet.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(wallet.publicKey).toMatch(/^0x04[0-9a-f]{128}$/);
    expect(wallet.deriveKey(DEFAULT_EVM_PATH).address).toBe(created.address);
  });

  it('rejects a wrong password without leaking secrets', () => {
    const { mnemonic, encrypted } = createWallet(PASSWORD);

    let message = '';
    try {
      unlockWallet(encrypted, 'wrong password');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toBe('');
    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain(mnemonic);
    expect(message.toLowerCase()).not.toContain('privatekey');
    expect(message.toLowerCase()).not.toContain('seed');
  });

  it('rejects tampered ciphertext', () => {
    const { encrypted } = createWallet(PASSWORD);
    const tampered: EncryptedKeystore = {
      ...encrypted,
      ciphertext: flipLastHexChar(encrypted.ciphertext),
    };

    expect(() => unlockWallet(tampered, PASSWORD)).toThrow(InvalidPasswordError);
  });

  it('rejects tampered auth tags', () => {
    const { encrypted } = createWallet(PASSWORD);
    const tampered: EncryptedKeystore = {
      ...encrypted,
      authTag: flipLastHexChar(encrypted.authTag),
    };

    expect(() => unlockWallet(tampered, PASSWORD)).toThrow(InvalidPasswordError);
  });

  it('rejects malformed keystores', () => {
    const { encrypted } = createWallet(PASSWORD);

    expect(() => unlockWallet({ ...encrypted, version: 99 }, PASSWORD)).toThrow(
      MalformedKeystoreError,
    );
    expect(() => unlockWallet({ ...encrypted, kdf: 'pbkdf2' } as never, PASSWORD)).toThrow(
      MalformedKeystoreError,
    );
    // Deliberately malformed hex: the cast keeps the fixture readable.
    expect(() => unlockWallet({ ...encrypted, salt: 'nope' as Hex }, PASSWORD)).toThrow(
      MalformedKeystoreError,
    );
  });

  it('keeps the mnemonic and private keys out of the persisted blob', () => {
    const { mnemonic, encrypted } = importWallet(ABANDON_MNEMONIC, PASSWORD);
    const serialized = JSON.stringify(encrypted);
    const wallet = unlockWallet(encrypted, PASSWORD);

    expect(serialized).not.toContain(mnemonic);
    expect(serialized).not.toContain(wallet.privateKey);
    expect(serialized).not.toContain(wallet.publicKey);
    wallet.destroy();
  });
});

describe('deriveKey', () => {
  it('derives EVM, TRON and Solana keys from one unlocked wallet', () => {
    const wallet = unlockWallet(createWallet(PASSWORD).encrypted, PASSWORD);

    const evm = wallet.deriveKey("m/44'/60'/0'/0/1");
    const tron = wallet.deriveKey("m/44'/195'/0'/0/1");
    const solana = wallet.deriveKey("m/44'/501'/0'/0'");

    expect(evm.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(tron.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(decodeTronAddress(tron.address)[0]).toBe(0x41);
    expect(solana.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(solana.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(solana.publicKey).toMatch(/^0x[0-9a-f]{64}$/);
    wallet.destroy();
  });

  it('matches a derivation done straight from the seed', () => {
    const wallet = unlockWallet(importWallet(ABANDON_MNEMONIC, PASSWORD).encrypted, PASSWORD);
    const expected = deriveFromSeed(mnemonicToSeed(ABANDON_MNEMONIC), "m/44'/195'/0'/0/3");

    expect(wallet.deriveKey("m/44'/195'/0'/0/3")).toEqual(expected);
    wallet.destroy();
  });

  it('accepts the canonical 4-segment Solana path and 4-segment EVM paths', () => {
    const wallet = unlockWallet(createWallet(PASSWORD).encrypted, PASSWORD);

    expect(wallet.deriveKey("m/44'/501'/0'/0'").address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(wallet.deriveKey("m/44'/60'/0'/0").address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    wallet.destroy();
  });

  it('rejects unsupported paths', () => {
    const wallet = unlockWallet(createWallet(PASSWORD).encrypted, PASSWORD);
    const seed = mnemonicToSeed(ABANDON_MNEMONIC);

    expect(() => wallet.deriveKey("m/44'/999'/0'/0/0")).toThrow(UnsupportedPathError);
    expect(() => wallet.deriveKey("m/44'/501'/0/0'")).toThrow(UnsupportedPathError);
    expect(() => wallet.deriveKey("m/44'/60'/0'")).toThrow(UnsupportedPathError);
    expect(() => wallet.deriveKey('nonsense')).toThrow(UnsupportedPathError);
    expect(() => deriveFromSeed(seed, "m/44'/60'/0'/0/0'extra")).toThrow(UnsupportedPathError);
    wallet.destroy();
  });
});

describe('key hygiene', () => {
  it('wipes the in-memory seed on destroy', () => {
    const wallet = unlockWallet(createWallet(PASSWORD).encrypted, PASSWORD);

    wallet.destroy();

    expect(() => wallet.privateKey).toThrow(KeystoreError);
    expect(() => wallet.deriveKey(DEFAULT_EVM_PATH)).toThrow(KeystoreError);
  });

  it('never touches the filesystem or the console in keystore sources', () => {
    const keystoreDir = path.join(process.cwd(), 'src/keystore');
    const sources = fs.readdirSync(keystoreDir).filter((file) => file.endsWith('.ts'));

    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const source = fs.readFileSync(path.join(keystoreDir, file), 'utf8');

      expect(source).not.toMatch(/from '(node:)?fs'/);
      expect(source).not.toMatch(/writeFile|appendFile|createWriteStream|readFileSync/);
      expect(source).not.toMatch(/console\./);
      expect(source).not.toMatch(/localStorage|sessionStorage/);
    }
  });
});
