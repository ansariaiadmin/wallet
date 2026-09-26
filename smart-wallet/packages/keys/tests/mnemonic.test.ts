import { describe, expect, it } from 'vitest';
import { assertValid, generate, normalize, toSeed, validate } from '../src/mnemonic';
import { KeyStoreError } from '../src/types';

/** The BIP-39 reference phrase every vector in this suite is built on. */
const TEST_MNEMONIC = [
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'about',
].join(' ');

describe('generate', () => {
  it('produces a valid 12 word phrase by default', () => {
    const mnemonic = generate();

    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(validate(mnemonic)).toBe(true);
  });

  it('produces a valid 24 word phrase at 256 bits', () => {
    const mnemonic = generate(256);

    expect(mnemonic.split(' ')).toHaveLength(24);
    expect(validate(mnemonic)).toBe(true);
  });

  it('produces a valid 15 word phrase at 160 bits', () => {
    expect(generate(160).split(' ')).toHaveLength(15);
  });

  it('produces a valid 18 word phrase at 192 bits', () => {
    expect(generate(192).split(' ')).toHaveLength(18);
  });

  it('produces a valid 21 word phrase at 224 bits', () => {
    expect(generate(224).split(' ')).toHaveLength(21);
  });

  it('does not repeat a phrase across calls', () => {
    const phrases = new Set([generate(), generate(), generate()]);

    expect(phrases.size).toBe(3);
  });
});

describe('validate', () => {
  it('accepts the reference phrase', () => {
    expect(validate(TEST_MNEMONIC)).toBe(true);
  });

  it('accepts a phrase with odd whitespace and casing', () => {
    expect(validate(`  ${TEST_MNEMONIC.toUpperCase()}  `)).toBe(true);
  });

  it('rejects a phrase with a word outside the wordlist', () => {
    expect(validate(`${TEST_MNEMONIC} notaword`)).toBe(false);
  });

  it('rejects a phrase with a broken checksum', () => {
    const words = TEST_MNEMONIC.split(' ');
    words[11] = 'abandon';
    expect(validate(words.join(' '))).toBe(false);
  });

  it('rejects an empty string and a single word', () => {
    expect(validate('')).toBe(false);
    expect(validate('abandon')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(validate(undefined as unknown as string)).toBe(false);
  });
});

describe('normalize', () => {
  it('collapses whitespace', () => {
    expect(normalize('  abandon   abandon \n about ')).toBe('abandon abandon about');
  });

  it('returns an empty string for a non-string', () => {
    expect(normalize(null as unknown as string)).toBe('');
  });
});

describe('toSeed', () => {
  it('derives the documented 64 byte seed for the reference phrase', () => {
    const seed = toSeed(TEST_MNEMONIC);

    expect(seed).toHaveLength(64);
    expect(Buffer.from(seed).toString('hex')).toBe(
      '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1' +
        '9a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4',
    );
  });

  it('changes the seed when a passphrase is added', () => {
    const plain = toSeed(TEST_MNEMONIC);
    const withPassphrase = toSeed(TEST_MNEMONIC, 'twenty-fifth-word');

    expect(Buffer.from(withPassphrase).toString('hex')).not.toBe(
      Buffer.from(plain).toString('hex'),
    );
  });

  it('is deterministic', () => {
    expect(Buffer.from(toSeed(TEST_MNEMONIC)).toString('hex')).toBe(
      Buffer.from(toSeed(TEST_MNEMONIC)).toString('hex'),
    );
  });

  it('throws INVALID_MNEMONIC for an invalid phrase', () => {
    expect(() => toSeed('not a valid bip39 phrase at all')).toThrow(KeyStoreError);
    try {
      toSeed('not a valid bip39 phrase at all');
    } catch (error) {
      expect((error as KeyStoreError).code).toBe('INVALID_MNEMONIC');
    }
  });
});

describe('assertValid', () => {
  it('returns the normalized phrase', () => {
    expect(assertValid(`  ${TEST_MNEMONIC}  `)).toBe(TEST_MNEMONIC);
  });

  it('throws for an invalid phrase', () => {
    expect(() => assertValid('abandon')).toThrow(KeyStoreError);
  });
});
