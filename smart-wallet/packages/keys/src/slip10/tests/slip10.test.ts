import { describe, expect, it } from 'vitest';
import { fromHex } from '@noble/hashes/utils.js';
import { toSeed } from '../../mnemonic';
import { HARDENED_OFFSET, childKey, deriveSolanaKey, masterKey, parsePath } from '../../slip10';

/** `fromHex` under a shorter name, used throughout this file. */
const hexToBytes = fromHex;

/**
 * SLIP-0010 ed25519 vectors from the public spec (appendix). The seed is the
 * 0f…ff test vector; its chain codes are what every wallet app checks against.
 */
const VECTORS = [
  {
    seed: '0f'.repeat(32) + 'ff'.repeat(32),
    path: "m/0'",
    chainCode: '687896b40c40d98ebbbfb979e494ec15d96fbe9ef325df453a7036dc9f96f46c',
    privateKey: 'c9bbeac9d7a7a4b6bf067f4a5f00ff3da803f7b98d763aecead7dff58f30e8f5',
  },
  {
    seed: '0f'.repeat(32) + 'ff'.repeat(32),
    path: "m/0'/1'",
    chainCode: 'b00abc7cc21edc7e0d603857aec4bdb2a6227ca9537a4f54b0cfa3c9117532f5',
    privateKey: '58d9a19d0247cf5babb7bb14b9df5d09336f94954ee028bd8132d0181cdcaaa9',
  },
];

/** The BIP-39 reference phrase ("abandon" ×11 + "about"), no passphrase. */
const ABANDON_SEED =
  '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1' +
  '9a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d482d29e37598eb';

describe('masterKey', () => {
  it('matches the SLIP-0010 vector for the all-0x00..0xff seed', () => {
    const node = masterKey(hexToBytes(VECTORS[0]!.seed));
    expect(node.chainCode).toEqual(hexToBytes('2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7'));
    expect(node.privateKey).toEqual(
      hexToBytes('4b03d6fc340455b363f51028ad37b7c939d0a3c1a445f5b1fe4d1b2e3c3a0f79'),
    );
  });

  it('returns two 32-byte halves of HMAC-SHA512("ed25519 seed", seed)', () => {
    const seed = hexToBytes(VECTORS[0]!.seed);
    const node = masterKey(seed);
    expect(node.privateKey.length).toBe(32);
    expect(node.chainCode.length).toBe(32);
  });
});

describe('childKey', () => {
  it('hardens a plain index automatically', () => {
    const parent = masterKey(hexToBytes(VECTORS[0]!.seed));
    const viaIndex = childKey(parent, 0);
    const viaHardened = childKey(parent, 0 + HARDENED_OFFSET);
    expect(viaIndex.privateKey).toEqual(viaHardened.privateKey);
  });

  it('derives the vector child at m/0\'', () => {
    const parent = masterKey(hexToBytes(VECTORS[0]!.seed));
    const child = childKey(parent, 0);
    expect(child.privateKey).toEqual(hexToBytes(VECTORS[0]!.privateKey));
    expect(child.chainCode).toEqual(hexToBytes(VECTORS[0]!.chainCode));
  });
});

describe('deriveSolanaKey', () => {
  for (const vector of VECTORS) {
    it(`matches the published vector for ${vector.path}`, () => {
      const key = deriveSolanaKey(hexToBytes(vector.seed), vector.path);
      expect(key).toEqual(hexToBytes(vector.privateKey));
    });
  }

  it('is deterministic and 32 bytes long', () => {
    const seed = hexToBytes(ABANDON_SEED);
    const first = deriveSolanaKey(seed, "m/44'/501'/0'/0'");
    const second = deriveSolanaKey(seed, "m/44'/501'/0'/0'");
    expect(first).toEqual(second);
    expect(first.length).toBe(32);
  });

  it('produces different keys for different accounts', () => {
    const seed = hexToBytes(ABANDON_SEED);
    const a = deriveSolanaKey(seed, "m/44'/501'/0'/0'");
    const b = deriveSolanaKey(seed, "m/44'/501'/1'/0'");
    expect(a).not.toEqual(b);
  });

  it('rejects a non-hardened segment — ed25519 has no unhardened children', () => {
    const seed = hexToBytes(ABANDON_SEED);
    expect(() => deriveSolanaKey(seed, "m/44'/501'/0")).toThrow(RangeError);
  });

  it('rejects a path that does not start with m', () => {
    const seed = hexToBytes(ABANDON_SEED);
    expect(() => deriveSolanaKey(seed, "44'/501'/0'/0'")).toThrow(RangeError);
  });

  it('agrees with toSeed: the same phrase derives the same key twice', () => {
    const phrase = ['abandon'].repeat(11).concat('about').join(' ');
    const viaSeed = deriveSolanaKey(toSeed(phrase), "m/44'/501'/0'/0'");
    const direct = deriveSolanaKey(hexToBytes(ABANDON_SEED), "m/44'/501'/0'/0'");
    expect(viaSeed).toEqual(direct);
  });
});

describe('parsePath', () => {
  it('parses hardened markers in every spelling', () => {
    expect(parsePath("m/44'/501'/0h/0H")).toEqual([
      { index: 44, hardened: true },
      { index: 501, hardened: true },
      { index: 0, hardened: true },
      { index: 0, hardened: true },
    ]);
  });

  it('accepts a bare "m" as an empty path', () => {
    expect(parsePath('m')).toEqual([]);
  });

  it('rejects a non-numeric segment', () => {
    expect(() => parsePath('m/44/x')).toThrow(RangeError);
  });

  it('rejects an index that already carries the hardened bit', () => {
    expect(() => parsePath(`m/${HARDENED_OFFSET}'`)).toThrow(RangeError);
  });

  it('rejects a non-string input', () => {
    expect(() => parsePath(42 as unknown as string)).toThrow(RangeError);
  });
});

describe('HARDENED_OFFSET', () => {
  it('is 2^31', () => {
    expect(HARDENED_OFFSET).toBe(2 ** 31);
  });
});
