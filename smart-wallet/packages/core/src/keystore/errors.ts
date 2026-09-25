/** Base class for every error raised by the keystore. */
export class KeystoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Raised when a phrase fails BIP-39 validation. */
export class InvalidMnemonicError extends KeystoreError {
  constructor(reason: string) {
    super(`Invalid BIP-39 mnemonic: ${reason}`);
  }
}

/** Raised when a password cannot decrypt a keystore. */
export class InvalidPasswordError extends KeystoreError {
  constructor() {
    super('Failed to decrypt keystore: wrong password or corrupted data');
  }
}

/** Raised when an encrypted keystore blob is structurally invalid. */
export class MalformedKeystoreError extends KeystoreError {
  constructor(reason: string) {
    super(`Malformed encrypted keystore: ${reason}`);
  }
}

/** Raised for derivation paths the keystore cannot handle. */
export class UnsupportedPathError extends KeystoreError {
  constructor(path: string, reason: string) {
    super(`Unsupported derivation path "${path}": ${reason}`);
  }
}
