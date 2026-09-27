/**
 * BIP-39 phrases, built on `@scure/bip39` with the English wordlist.
 *
 * The wordlist is the only one shipped: the package is a wallet's key layer,
 * not a phrase recovery tool. Everything runs locally — `@scure/bip39` reads
 * entropy from `node:crypto` and never reaches out.
 */

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { KeyStoreError } from './types';

/** Supported entropy strengths: 128 bits = 12 words, 256 bits = 24 words. */
export type MnemonicStrength = 128 | 160 | 192 | 224 | 256;

/** Generates a fresh English BIP-39 phrase from the system CSPRNG. */
export function generate(strength: MnemonicStrength = 128): string {
  return generateMnemonic(wordlist, strength);
}

/**
 * Collapses runs of whitespace, trims and lower-cases the phrase.
 *
 * The wordlist is lower case, so a phrase typed in capitals has to be folded
 * before it can be checked; `assertValid` hands the folded form to the seed
 * derivation, which is what BIP-39 specifies.
 */
export function normalize(mnemonic: string): string {
  return typeof mnemonic === 'string' ? mnemonic.trim().toLowerCase().split(/\s+/).join(' ') : '';
}

/** True when `mnemonic` is a valid English BIP-39 phrase. */
export function validate(mnemonic: string): boolean {
  return validateMnemonic(normalize(mnemonic), wordlist);
}

/** Validates and normalizes a phrase, throwing {@link KeyStoreError} when invalid. */
export function assertValid(mnemonic: string): string {
  const normalized = normalize(mnemonic);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new KeyStoreError('unknown words or failed checksum', 'INVALID_MNEMONIC');
  }
  return normalized;
}

/**
 * Derives the 64-byte BIP-39 seed from a validated phrase.
 *
 * @param passphrase the optional "25th word"; it changes the seed and
 *   therefore every derived address.
 * @throws KeyStoreError `INVALID_MNEMONIC` when the phrase is not valid.
 */
export function toSeed(mnemonic: string, passphrase = ''): Uint8Array {
  return mnemonicToSeedSync(assertValid(mnemonic), passphrase);
}
