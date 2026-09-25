import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  assertValidMnemonic,
  generateMnemonicPhrase,
  isValidMnemonic,
  mnemonicToSeed,
  normalizeMnemonic,
} from '@core/keystore/mnemonic';
import { InvalidMnemonicError } from '@core/keystore/errors';

/** Official BIP-39 vectors from the Trezor reference implementation (passphrase "TREZOR"). */
const BIP39_VECTORS: ReadonlyArray<{ mnemonic: string; seed: string }> = [
  {
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    seed: 'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
  },
  {
    mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
    seed: '2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607',
  },
  {
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon agent',
    seed: '035895f2f481b1b0f01fcf8c289c794660b289981a78f8106447707fdd9666ca06da5a9a565181599b79f53b844d8a71dd9f439c52a3d7b3e8a79c906ac845fa',
  },
  {
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
    seed: 'bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8',
  },
];

describe('BIP-39 mnemonics', () => {
  it('derives the official seeds for known mnemonics', () => {
    for (const { mnemonic, seed } of BIP39_VECTORS) {
      expect(bytesToHex(mnemonicToSeed(mnemonic, 'TREZOR'))).toBe(seed);
    }
  });

  it('derives a 64-byte seed without a passphrase', () => {
    const seed = mnemonicToSeed(BIP39_VECTORS[0]!.mnemonic);
    expect(seed).toHaveLength(64);
  });

  it('changes the seed when a passphrase is used', () => {
    const phrase = BIP39_VECTORS[0]!.mnemonic;
    expect(bytesToHex(mnemonicToSeed(phrase, ''))).not.toBe(
      bytesToHex(mnemonicToSeed(phrase, 'x')),
    );
  });

  it('generates 12-word mnemonics by default', () => {
    const mnemonic = generateMnemonicPhrase();

    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(isValidMnemonic(mnemonic)).toBe(true);
  });

  it('generates 24-word mnemonics at 256-bit strength', () => {
    const mnemonic = generateMnemonicPhrase(256);

    expect(mnemonic.split(' ')).toHaveLength(24);
    expect(isValidMnemonic(mnemonic)).toBe(true);
  });

  it('generates unique mnemonics on every call', () => {
    const phrases = new Set(Array.from({ length: 5 }, () => generateMnemonicPhrase()));

    expect(phrases.size).toBe(5);
  });

  it('normalizes surrounding and repeated whitespace', () => {
    expect(normalizeMnemonic('  abandon   abandon\tabandon ')).toBe('abandon abandon abandon');
  });

  it('accepts a phrase with messy whitespace', () => {
    const phrase = BIP39_VECTORS[0]!.mnemonic;
    const messy = `  ${phrase.replace(/ /g, '   ')}  `;

    expect(bytesToHex(mnemonicToSeed(messy, 'TREZOR'))).toBe(BIP39_VECTORS[0]!.seed);
  });

  it('rejects a phrase with a broken checksum', () => {
    const broken =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';

    expect(isValidMnemonic(broken)).toBe(false);
    expect(() => assertValidMnemonic(broken)).toThrow(InvalidMnemonicError);
  });

  it('rejects unknown words', () => {
    expect(
      isValidMnemonic('notaword abandon abandon abandon abandon abandon abandon abandon'),
    ).toBe(false);
    expect(() => mnemonicToSeed('notaword', 'TREZOR')).toThrow(InvalidMnemonicError);
  });

  it('round-trips entropy through hex helpers used by tests', () => {
    expect(bytesToHex(hexToBytes('c0ffee'))).toBe('c0ffee');
  });
});
