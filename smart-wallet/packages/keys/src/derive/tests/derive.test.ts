import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { Keypair } from '@solana/web3.js';
import {
  deriveAll,
  deriveEvm,
  deriveKey,
  deriveSolana,
  deriveTron,
  evmAddress,
  pathFor,
  solanaAddress,
  tronAddress,
} from '../../derive';
import { deriveSolanaKey } from '../../slip10';
import { toSeed } from '../../mnemonic';
import { KeyStoreError } from '../../types';

/** The BIP-39 reference phrase; its BIP-44 vectors are public. */
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
/** A second, unrelated phrase for the "different mnemonic" cases. */
const OTHER_MNEMONIC = [
  'legal',
  'winner',
  'thank',
  'year',
  'wave',
  'sausage',
  'worth',
  'useful',
  'legal',
  'winner',
  'thank',
  'yellow',
].join(' ');

describe('pathFor', () => {
  it('builds the EVM path', () => {
    expect(pathFor('evm')).toBe("m/44'/60'/0'/0/0");
    expect(pathFor('evm', { addressIndex: 3 })).toBe("m/44'/60'/0'/0/3");
    expect(pathFor('evm', { accountIndex: 2, addressIndex: 1 })).toBe("m/44'/60'/2'/0/1");
  });

  it('builds the TRON path', () => {
    expect(pathFor('tron')).toBe("m/44'/195'/0'/0/0");
    expect(pathFor('tron', { addressIndex: 5 })).toBe("m/44'/195'/0'/0/5");
  });

  it('builds the Solana path with hardened segments only', () => {
    expect(pathFor('solana')).toBe("m/44'/501'/0'/0'");
    expect(pathFor('solana', { addressIndex: 2 })).toBe("m/44'/501'/2'/0'");
  });

  it('rejects an unknown family', () => {
    expect(() => pathFor('dogecoin' as never)).toThrow(KeyStoreError);
  });
});

describe('deriveEvm', () => {
  it('derives the published BIP-44 vector address', () => {
    const key = deriveEvm(TEST_MNEMONIC);

    expect(key.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    expect(key.path).toBe("m/44'/60'/0'/0/0");
  });

  it('agrees with viem on the address for the same private key', () => {
    const key = deriveEvm(TEST_MNEMONIC);
    const account = privateKeyToAccount(`0x${Buffer.from(key.privateKey).toString('hex')}`);

    expect(account.address).toBe(key.address);
  });

  it('derives a different address per index', () => {
    const first = deriveEvm(TEST_MNEMONIC, 0);
    const second = deriveEvm(TEST_MNEMONIC, 1);

    expect(second.address).toBe('0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0');
    expect(second.address).not.toBe(first.address);
    expect(second.path).toBe("m/44'/60'/0'/0/1");
  });

  it('derives a different address per account', () => {
    const first = deriveEvm(TEST_MNEMONIC, 0, { accountIndex: 0 });
    const second = deriveEvm(TEST_MNEMONIC, 0, { accountIndex: 1 });

    expect(second.address).not.toBe(first.address);
  });

  it('returns a 32 byte private key and a 65 byte uncompressed public key', () => {
    const key = deriveEvm(TEST_MNEMONIC);

    expect(key.privateKey).toHaveLength(32);
    expect(key.publicKey).toHaveLength(65);
    expect(key.publicKey[0]).toBe(0x04);
  });

  it('changes the address when a passphrase is used', () => {
    const plain = deriveEvm(TEST_MNEMONIC);
    const withPassphrase = deriveEvm(TEST_MNEMONIC, 0, { passphrase: 'twenty-fifth-word' });

    expect(withPassphrase.address).not.toBe(plain.address);
  });

  it('is deterministic', () => {
    expect(deriveEvm(TEST_MNEMONIC, 4).address).toBe(deriveEvm(TEST_MNEMONIC, 4).address);
  });

  it('derives a different address for a different mnemonic', () => {
    expect(deriveEvm(OTHER_MNEMONIC).address).not.toBe(deriveEvm(TEST_MNEMONIC).address);
  });
});

describe('deriveTron', () => {
  it('derives a base58check address', () => {
    const key = deriveTron(TEST_MNEMONIC);

    expect(key.address).toBe('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
    expect(key.address).toHaveLength(34);
    expect(key.address.startsWith('T')).toBe(true);
  });

  it('shares the secp256k1 key with the EVM path at the same index', () => {
    const tron = deriveTron(TEST_MNEMONIC, 0);

    // Same curve, different coin type, so the keys differ but the shapes match.
    expect(tron.privateKey).toHaveLength(32);
    expect(tron.path).toBe("m/44'/195'/0'/0/0");
  });

  it('decodes to the 0x41 prefix with a valid checksum', async () => {
    const { base58check } = await import('@scure/base');
    const { sha256 } = await import('@noble/hashes/sha2.js');
    const { keccak_256 } = await import('@noble/hashes/sha3.js');
    const key = deriveTron(TEST_MNEMONIC);
    const decoded = base58check(sha256).decode(key.address);

    // base58check decodes to the payload only: prefix + 20 byte hash.
    expect(decoded).toHaveLength(21);
    expect(decoded[0]).toBe(0x41);
    // The payload is 0x41 || keccak(publicKey)[12:], exactly like an EVM address.
    const expected = keccak_256(key.publicKey.subarray(1)).subarray(-20);
    expect(Buffer.from(decoded.subarray(1, 21))).toEqual(Buffer.from(expected));
  });

  it('keeps TRON keys apart from EVM keys through the coin type', () => {
    const tron = deriveTron(TEST_MNEMONIC);
    const evm = deriveEvm(TEST_MNEMONIC);

    expect(Buffer.from(tron.privateKey).toString('hex')).not.toBe(
      Buffer.from(evm.privateKey).toString('hex'),
    );
  });

  it('derives a different address per index', () => {
    expect(deriveTron(TEST_MNEMONIC, 1).address).toBe('TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK');
    expect(deriveTron(TEST_MNEMONIC, 1).address).not.toBe(deriveTron(TEST_MNEMONIC, 0).address);
  });
});

describe('deriveSolana', () => {
  it('derives a base58 address from the ed25519 public key', () => {
    const key = deriveSolana(TEST_MNEMONIC);

    expect(key.address).toBe('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
    expect(key.path).toBe("m/44'/501'/0'/0'");
    expect(key.publicKey).toHaveLength(32);
  });

  it('agrees with @solana/web3.js on the address for the same seed', () => {
    const key = deriveSolana(TEST_MNEMONIC);

    expect(Keypair.fromSeed(key.privateKey).publicKey.toBase58()).toBe(key.address);
  });

  it('uses only hardened segments', () => {
    const key = deriveSolana(TEST_MNEMONIC, 3);

    expect(key.path).toBe("m/44'/501'/3'/0'");
    expect(
      key.path
        .split('/')
        .slice(1)
        .every((segment) => segment.endsWith("'")),
    ).toBe(true);
  });

  it('derives a different address per index', () => {
    expect(deriveSolana(TEST_MNEMONIC, 1).address).toBe(
      'Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb',
    );
  });

  it('rejects a path with a non-hardened segment', () => {
    const seed = toSeed(TEST_MNEMONIC);

    expect(() => deriveSolanaKey(seed, "m/44'/501'/0'/0")).toThrow(RangeError);
  });

  it('rejects a path that is not a path', () => {
    const seed = toSeed(TEST_MNEMONIC);

    expect(() => deriveSolanaKey(seed, 'nonsense')).toThrow(RangeError);
  });
});

describe('deriveKey', () => {
  it('dispatches on the family', () => {
    const seed = toSeed(TEST_MNEMONIC);

    expect(deriveKey(seed, 'evm', pathFor('evm')).address).toBe(deriveEvm(TEST_MNEMONIC).address);
    expect(deriveKey(seed, 'tron', pathFor('tron')).address).toBe(
      deriveTron(TEST_MNEMONIC).address,
    );
    expect(deriveKey(seed, 'solana', pathFor('solana')).address).toBe(
      deriveSolana(TEST_MNEMONIC).address,
    );
  });

  it('rejects an unknown family', () => {
    const seed = toSeed(TEST_MNEMONIC);

    expect(() => deriveKey(seed, 'dogecoin' as never, 'm/0')).toThrow(KeyStoreError);
  });
});

describe('deriveAll', () => {
  it('returns one key per family', () => {
    const keys = deriveAll(TEST_MNEMONIC);

    expect(Object.keys(keys).sort()).toEqual(['evm', 'solana', 'tron']);
    expect(keys.evm.address.startsWith('0x')).toBe(true);
    expect(keys.solana.address.length).toBeGreaterThan(30);
    expect(keys.tron.address.startsWith('T')).toBe(true);
  });
});

describe('address helpers', () => {
  it('checksums an EVM address', () => {
    const key = deriveEvm(TEST_MNEMONIC);

    expect(evmAddress(key.publicKey)).toBe(key.address);
    expect(key.address.slice(2)).not.toBe(key.address.slice(2).toLowerCase());
  });

  it('encodes a Solana address', () => {
    const key = deriveSolana(TEST_MNEMONIC);

    expect(solanaAddress(key.publicKey)).toBe(key.address);
  });

  it('rejects a wrong-sized ed25519 public key', () => {
    expect(() => solanaAddress(new Uint8Array(31))).toThrow(KeyStoreError);
  });

  it('encodes a TRON address', () => {
    const key = deriveTron(TEST_MNEMONIC);

    expect(tronAddress(key.publicKey)).toBe(key.address);
  });
});
