import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { toSeed } from '../../mnemonic';
import { HARDENED_OFFSET, childKey, deriveSolanaKey, masterKey, parsePath } from '../../slip10';

/**
 * SLIP-0010 ed25519 vectors for the 0f…ff seed from the public spec appendix.
 * The master key and both child nodes are pinned here so a regression in
 * either HMAC layer (master salt or child framing) fails loudly.
 */
const SLIP10_SEED = '0f'.repeat(32) + 'ff'.repeat(32);

const MASTER = {
  privateKey: '05df4e69b4d779f5201b907211ff7c61c3308c42e2cd877724b770a134311c8b',
  chainCode: '9b9b5334145046179f1a79b050c920c9887531fac15a5f98895558e4d2dab51d',
};

const VECTORS = [
  {
    seed: SLIP10_SEED,
    path: "m/0'",
    chainCode: '6c3acf481e20da6d72657f50ea424af09852363264190994ffde80f82519dc71',
    privateKey: '48eda094ee4ec8398ae1d7f2b343d6e9bfbc869f6d75007fd399b9f873f7e32f',
  },
  {
    seed: SLIP10_SEED,
    path: "m/0'/1'",
    chainCode: '6bc883906890345d428b125523e411787187b25f3305cbccace1fa8d128228ad',
    privateKey: '48e8f461776b4c97d6b53fab70b2381a422f1d13e70536bf11a84c312cd006d1',
  },
];

/** The BIP-39 reference phrase ("abandon" ×11 + "about"), no passphrase. */
const ABANDON_SEED =
  '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1' +
  '9a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4';

describe('masterKey', () => {
  it('matches the SLIP-0010 vector for the 0f…ff seed', () => {
    const node = masterKey(hexToBytes(SLIP10_SEED));
    expect(node.chainCode).toEqual(hexToBytes(MASTER.chainCode));
    expect(node.privateKey).toEqual(hexToBytes(MASTER.privateKey));
  });

  it('returns two 32-byte halves of HMAC-SHA512("ed25519 seed", seed)', () => {
    const seed = hexToBytes(SLIP10_SEED);
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

  it("derives the vector child at m/0'", () => {
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
    const phrase = `${'abandon '.repeat(11)}about`;
    const viaSeed = deriveSolanaKey(toSeed(phrase), "m/44'/501'/0'/0'");
    const direct = deriveSolanaKey(hexToBytes(ABANDON_SEED), "m/44'/501'/0'/0'");
    expect(viaSeed).toEqual(direct);
  });

  it("derives the published Solana key at m/44'/501'/0'/0' from the abandon seed", () => {
    // Pinned independently of toSeed so a BIP-39 change cannot mask a
    // SLIP-0010 regression (and vice versa).
    const key = deriveSolanaKey(hexToBytes(ABANDON_SEED), "m/44'/501'/0'/0'");
    expect(bytesToHex(key)).toBe(
      '37df573b3ac4ad5b522e064e25b63ea16bcbe79d449e81a0268d1047948bb445',
    );
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
