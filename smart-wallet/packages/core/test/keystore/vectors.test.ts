import { describe, expect, it } from 'vitest';
import { HDKey } from '@scure/bip32';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { deriveFromSeed } from '@core/keystore/hd';
import { mnemonicToSeed } from '@core/keystore/mnemonic';
import { ed25519DeriveChild, ed25519MasterFromSeed, ed25519PublicKey } from '@core/keystore/slip10';
import { importWallet } from '@core/keystore/keystore';

/** Canonical test mnemonic (all-zero entropy, 12 words). */
const ABANDON_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** SLIP-0010 test vector 2 seed (shared by the secp256k1 and ed25519 vector sets). */
const SLIP10_SEED = hexToBytes(
  'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542',
);

describe('SLIP-0010 ed25519 vectors', () => {
  /** Expected values from SLIP-0010 test vector 2 (public keys carry a 0x00 prefix). */
  const vectors = [
    {
      path: 'm',
      privateKey: '171cb88b1b3c1db25add599712e36245d75bc65a1a5c9e18d76f9f2b1eab4012',
      chainCode: 'ef70a74db9c3a5af931b5fe73ed8e1a53464133654fd55e7a66f8570b8e33c3b',
      publicKey: '8fe9693f8fa62a4305a140b9764c5ee01e455963744fe18204b4fb948249308a',
    },
    {
      path: "m/0'",
      privateKey: '1559eb2bbec5790b0c65d8693e4d0875b1747f4970ae8b650486ed7470845635',
      chainCode: '0b78a3226f915c082bf118f83618a618ab6dec793752624cbeb622acb562862d',
      publicKey: '86fab68dcb57aa196c77c5f264f215a112c22a912c10d123b0d03c3c28ef1037',
    },
    {
      path: "m/0'/2147483647'",
      privateKey: 'ea4f5bfe8694d8bb74b7b59404632fd5968b774ed545e810de9c32a4fb4192f4',
      chainCode: '138f0b2551bcafeca6ff2aa88ba8ed0ed8de070841f0c4ef0165df8181eaad7f',
      publicKey: '5ba3b9ac6e90e83effcd25ac4e58a1365a9e35a3d3ae5eb07b9e4d90bcf7506d',
    },
  ] as const;

  it('matches the reference master node', () => {
    const master = ed25519MasterFromSeed(SLIP10_SEED);

    expect(bytesToHex(master.privateKey)).toBe(vectors[0]!.privateKey);
    expect(bytesToHex(master.chainCode)).toBe(vectors[0]!.chainCode);
    expect(bytesToHex(ed25519PublicKey(master))).toBe(vectors[0]!.publicKey);
  });

  it('matches the reference hardened child nodes', () => {
    let node = ed25519MasterFromSeed(SLIP10_SEED);
    node = ed25519DeriveChild(node, 0x80000000);
    expect(bytesToHex(node.privateKey)).toBe(vectors[1]!.privateKey);
    expect(bytesToHex(node.chainCode)).toBe(vectors[1]!.chainCode);
    expect(bytesToHex(ed25519PublicKey(node))).toBe(vectors[1]!.publicKey);

    node = ed25519DeriveChild(node, 0x80000000 + 2147483647);
    expect(bytesToHex(node.privateKey)).toBe(vectors[2]!.privateKey);
    expect(bytesToHex(node.chainCode)).toBe(vectors[2]!.chainCode);
    expect(bytesToHex(ed25519PublicKey(node))).toBe(vectors[2]!.publicKey);
  });

  it('refuses non-hardened ed25519 derivation', () => {
    const master = ed25519MasterFromSeed(SLIP10_SEED);

    expect(() => ed25519DeriveChild(master, 0)).toThrow(RangeError);
  });
});

describe('SLIP-0010 secp256k1 vectors', () => {
  it('matches the reference master node (BIP-32 compatible)', () => {
    const master = HDKey.fromMasterSeed(SLIP10_SEED);

    expect(bytesToHex(master.privateKey!)).toBe(
      '4b03d6fc340455b363f51020ad3ecca4f0850280cf436c70c727923f6db46c3e',
    );
    expect(bytesToHex(master.publicKey!)).toBe(
      '03cbcaa9c98c877a26977d00825c956a238e8dddfbd322cce4f74b0b5bd6ace4a7',
    );
    expect(bytesToHex(master.chainCode!)).toBe(
      '60499f801b896d83179a4374aeb7822aaeaceaa0db1f85ee3e904c4defbd9689',
    );
  });
});

describe('EVM address derivation', () => {
  it('derives the canonical address for the all-abandon mnemonic', () => {
    const seed = mnemonicToSeed(ABANDON_MNEMONIC);
    const key = deriveFromSeed(seed, "m/44'/60'/0'/0/0");

    expect(key.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    expect(key.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(key.publicKey).toMatch(/^0x04[0-9a-f]{128}$/);
  });

  it('derives different addresses per account index', () => {
    const seed = mnemonicToSeed(ABANDON_MNEMONIC);
    const first = deriveFromSeed(seed, "m/44'/60'/0'/0/0");
    const second = deriveFromSeed(seed, "m/44'/60'/0'/0/1");

    expect(first.address).not.toBe(second.address);
    expect(first.privateKey).not.toBe(second.privateKey);
  });

  it('derives the canonical address through the public wallet API', () => {
    const imported = importWallet(ABANDON_MNEMONIC, 'test-password-123', {
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(imported.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    expect(imported.encrypted.address).toBe(imported.address);
    expect(imported.encrypted.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
