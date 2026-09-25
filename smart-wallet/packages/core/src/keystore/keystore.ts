import {
  decryptWithPassword,
  encryptWithPassword,
  DEFAULT_SCRYPT_PARAMS,
  type ScryptParams,
} from './encryption';

export { DEFAULT_SCRYPT_PARAMS, type ScryptParams } from './encryption';
import { KeystoreError, MalformedKeystoreError } from './errors';
import { deriveFromSeed, type DerivedKey } from './hd';
import type { Hex } from './hex';
import {
  assertValidMnemonic,
  generateMnemonicPhrase,
  mnemonicToSeed,
  type MnemonicStrength,
} from './mnemonic';
import { DEFAULT_EVM_PATH } from './paths';

/** Version tag written into every encrypted keystore. */
export const KEYSTORE_VERSION = 1;

/** Encrypted keystore blob: safe to persist, useless without the password. */
export interface EncryptedKeystore {
  readonly version: number;
  readonly kdf: 'scrypt';
  readonly kdfParams: ScryptParams;
  readonly cipher: 'aes-256-gcm';
  readonly salt: Hex;
  readonly iv: Hex;
  readonly ciphertext: Hex;
  readonly authTag: Hex;
  /** Address derived at {@link EncryptedKeystore.path} (public info). */
  readonly address: string;
  /** Derivation path the blob was created for. */
  readonly path: string;
  readonly createdAt: string;
}

/** Options shared by wallet creation and import. */
export interface CreateWalletOptions {
  /** Entropy strength: 128 = 12 words, 256 = 24 words. Default 128. */
  readonly strength?: MnemonicStrength;
  /** BIP-44 path for the returned address. Default EVM `m/44'/60'/0'/0/0`. */
  readonly path?: string;
  /** Optional BIP-39 passphrase ("25th word"). */
  readonly passphrase?: string;
  /** scrypt overrides; defaults are N=32768, r=8, p=1, keylen=32. */
  readonly kdf?: Partial<ScryptParams>;
  /** Clock injection for deterministic tests. */
  readonly now?: () => Date;
}

/** Result of creating or importing a wallet. */
export interface CreatedWallet {
  readonly mnemonic: string;
  readonly encrypted: EncryptedKeystore;
  readonly address: string;
}

/** A decrypted, in-memory wallet. Never persist this object. */
export interface UnlockedWallet {
  readonly privateKey: Hex;
  readonly publicKey: Hex;
  readonly address: string;
  readonly path: string;
  /** Derives another keypair from the in-memory seed. */
  deriveKey(path: string): DerivedKey;
  /** Zeroes the in-memory seed; the wallet cannot be used afterwards. */
  destroy(): void;
}

class UnlockedWalletImpl implements UnlockedWallet {
  private seed: Uint8Array | null;
  private cached: DerivedKey | null = null;

  constructor(
    seed: Uint8Array,
    private readonly encrypted: EncryptedKeystore,
  ) {
    this.seed = seed;
  }

  get path(): string {
    return this.encrypted.path;
  }

  get privateKey(): Hex {
    return this.keys().privateKey;
  }

  get publicKey(): Hex {
    return this.keys().publicKey;
  }

  get address(): string {
    return this.keys().address;
  }

  deriveKey(path: string): DerivedKey {
    return deriveFromSeed(this.requireSeed(), path);
  }

  destroy(): void {
    this.seed?.fill(0);
    this.seed = null;
    this.cached = null;
  }

  private keys(): DerivedKey {
    this.cached ??= deriveFromSeed(this.requireSeed(), this.encrypted.path);
    return this.cached;
  }

  private requireSeed(): Uint8Array {
    if (this.seed === null) {
      throw new KeystoreError('Wallet is locked — unlock it again with the password');
    }
    return this.seed;
  }
}

/** Generates a fresh mnemonic and returns the wallet plus its encrypted blob. */
export function createWallet(password: string, options: CreateWalletOptions = {}): CreatedWallet {
  const mnemonic = generateMnemonicPhrase(options.strength ?? 128);
  return buildWallet(mnemonic, password, options);
}

/** Restores a wallet from an existing BIP-39 mnemonic. */
export function importWallet(
  mnemonic: string,
  password: string,
  options: CreateWalletOptions = {},
): CreatedWallet {
  return buildWallet(assertValidMnemonic(mnemonic), password, options);
}

/** Decrypts a keystore blob and returns the in-memory wallet. */
export function unlockWallet(encrypted: EncryptedKeystore, password: string): UnlockedWallet {
  assertKeystoreShape(encrypted);
  const seed = decryptWithPassword(encrypted, password, encrypted.kdfParams);
  return new UnlockedWalletImpl(seed, encrypted);
}

function buildWallet(
  mnemonic: string,
  password: string,
  options: CreateWalletOptions,
): CreatedWallet {
  const seed = mnemonicToSeed(mnemonic, options.passphrase ?? '');
  const path = options.path ?? DEFAULT_EVM_PATH;
  const { address } = deriveFromSeed(seed, path);

  const params: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, ...options.kdf };
  const payload = encryptWithPassword(seed, password, params);

  const encrypted: EncryptedKeystore = {
    version: KEYSTORE_VERSION,
    kdf: 'scrypt',
    kdfParams: params,
    cipher: 'aes-256-gcm',
    salt: payload.salt,
    iv: payload.iv,
    ciphertext: payload.ciphertext,
    authTag: payload.authTag,
    address,
    path,
    createdAt: (options.now?.() ?? new Date()).toISOString(),
  };

  seed.fill(0);
  return { mnemonic, encrypted, address };
}

function assertKeystoreShape(keystore: EncryptedKeystore): void {
  if (keystore === null || typeof keystore !== 'object') {
    throw new MalformedKeystoreError('expected an object');
  }
  if (keystore.version !== KEYSTORE_VERSION) {
    throw new MalformedKeystoreError(`unsupported version ${String(keystore.version)}`);
  }
  if (keystore.kdf !== 'scrypt' || keystore.cipher !== 'aes-256-gcm') {
    throw new MalformedKeystoreError('unsupported kdf or cipher');
  }
  for (const field of ['salt', 'iv', 'ciphertext', 'authTag'] as const) {
    const value = keystore[field];
    if (typeof value !== 'string' || !/^0x[0-9a-f]*$/.test(value)) {
      throw new MalformedKeystoreError(`field "${field}" must be 0x-prefixed hex`);
    }
  }
  const { N, r, p, keylen } = keystore.kdfParams;
  if (![N, r, p, keylen].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new MalformedKeystoreError('kdfParams must be positive integers');
  }
}
