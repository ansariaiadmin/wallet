import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { InvalidMnemonicError } from './errors';

/** Supported BIP-39 entropy strengths: 128 bits = 12 words, 256 bits = 24 words. */
export type MnemonicStrength = 128 | 256;

/** Generates a fresh English BIP-39 mnemonic from a CSPRNG. */
export function generateMnemonicPhrase(strength: MnemonicStrength = 128): string {
  return generateMnemonic(wordlist, strength);
}

/** Normalizes whitespace and casing of a phrase. */
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().split(/\s+/).join(' ');
}

/** True when `mnemonic` is a valid English BIP-39 phrase. */
export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(normalizeMnemonic(mnemonic), wordlist);
}

/** Validates and normalizes a phrase, throwing {@link InvalidMnemonicError}. */
export function assertValidMnemonic(mnemonic: string): string {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new InvalidMnemonicError('unknown words or failed checksum');
  }
  return normalized;
}

/** Derives the 64-byte BIP-39 seed from a validated phrase plus optional passphrase. */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Uint8Array {
  return mnemonicToSeedSync(assertValidMnemonic(mnemonic), passphrase);
}
