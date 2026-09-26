import { describe, expect, it } from 'vitest';
import { recoverMessageAddress, recoverTransactionAddress } from 'viem';
import { createEvmSigner, type EvmTxRequest } from '../../src/signers/evm';
import { deriveEvm } from '../../src/derive';
import { KeyStoreError } from '../../src/types';

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
const RECIPIENT = '0x00000000219ab540356cBB839Cbe05303d7705Fa';

/** A legacy transfer request, complete enough for viem to serialize. */
const LEGACY_TX: EvmTxRequest = {
  type: 'legacy',
  chainId: 1,
  nonce: 0,
  gas: 21_000n,
  gasPrice: 30_000_000_000n,
  to: RECIPIENT,
  value: 1_000_000_000_000_000_000n,
};

/** An EIP-1559 transfer request. */
const EIP1559_TX: EvmTxRequest = {
  type: 'eip1559',
  chainId: 1,
  nonce: 0,
  gas: 21_000n,
  maxFeePerGas: 40_000_000_000n,
  maxPriorityFeePerGas: 1_500_000_000n,
  to: RECIPIENT,
  value: 1_000_000_000_000_000_000n,
};

/** viem types the serialized transaction as a template literal. */
function recoveredSigner(signed: `0x${string}`): Promise<`0x${string}`> {
  return recoverTransactionAddress({ serializedTransaction: signed as `0x02${string}` });
}

describe('createEvmSigner', () => {
  it('exposes the checksummed address of the key', () => {
    const key = deriveEvm(TEST_MNEMONIC);
    const signer = createEvmSigner(key.privateKey);

    expect(signer.address).toBe(key.address);
    expect(signer.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    signer.destroy();
  });

  it('rejects a key of the wrong length', () => {
    expect(() => createEvmSigner(new Uint8Array(31))).toThrow(KeyStoreError);
    try {
      createEvmSigner(new Uint8Array(33));
    } catch (error) {
      expect((error as KeyStoreError).code).toBe('INVALID_INPUT');
    }
  });

  it('rejects a value that is not a Uint8Array', () => {
    expect(() => createEvmSigner('0xdeadbeef' as never)).toThrow(KeyStoreError);
  });
});

describe('signMessage', () => {
  it('produces a signature that recovers to the signer', async () => {
    const signer = createEvmSigner(deriveEvm(TEST_MNEMONIC).privateKey);

    const signature = await signer.signMessage('hello wallet');
    const recovered = await recoverMessageAddress({ message: 'hello wallet', signature });

    expect(signature.startsWith('0x')).toBe(true);
    expect(signature).toHaveLength(132); // 65 bytes
    expect(recovered).toBe(signer.address);
    signer.destroy();
  });

  it('verifies only against the message it was made for', async () => {
    const { verifyMessage } = await import('viem');
    const signer = createEvmSigner(deriveEvm(TEST_MNEMONIC).privateKey);
    const signature = await signer.signMessage('hello wallet');

    expect(
      await verifyMessage({ message: 'hello wallet', signature, address: signer.address }),
    ).toBe(true);
    // The EIP-191 prefix is part of what makes the signature unique.
    expect(
      await verifyMessage({ message: 'goodbye wallet', signature, address: signer.address }),
    ).toBe(false);
    signer.destroy();
  });

  it('signs raw bytes', async () => {
    const signer = createEvmSigner(deriveEvm(TEST_MNEMONIC).privateKey);
    const bytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);

    const signature = await signer.signMessage(bytes);
    const recovered = await recoverMessageAddress({ message: { raw: '0xdeadbeef' }, signature });

    expect(recovered).toBe(signer.address);
    signer.destroy();
  });

  it('produces a different signature for a different key', async () => {
    const first = createEvmSigner(deriveEvm(TEST_MNEMONIC).privateKey);
    const second = createEvmSigner(deriveEvm(OTHER_MNEMONIC).privateKey);

    const one = await first.signMessage('same message');
    const two = await second.signMessage('same message');

    expect(one).not.toBe(two);
    expect(await recoverMessageAddress({ message: 'same message', signature: two })).toBe(
      second.address,
    );
    first.destroy();
    second.destroy();
  });
});

/** EIP-712 data a wallet signs for a Permit-style approval. */
const TYPED_DATA = {
  domain: {
    name: 'SmartWallet',
    version: '1',
    chainId: 1,
    verifyingContract: '0x00000000219ab540356cBB839Cbe05303d7705Fa',
  },
  types: {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
    ],
  },
  primaryType: 'Permit',
  message: {
    owner: '0x00000000219ab540356cBB839Cbe05303d7705Fa',
    spender: '0x00000000219ab540356cBB839Cbe05303d7705Fa',
    value: 1000n,
    nonce: 0n,
  },
} as const;

describe('signTypedData', () => {
  it('produces a signature that recovers to the signer', async () => {
    const { recoverTypedDataAddress } = await import('viem');
    const signer = createEvmSigner(deriveEvm(TEST_MNEMONIC).privateKey);

    const signature = await signer.signTypedData(TYPED_DATA);
    const recovered = await recoverTypedDataAddress({ ...TYPED_DATA, signature });

    expect(recovered).toBe(signer.address);
    signer.destroy();
  });
});

describe('signRaw', () => {
  it('returns verifiable secp256k1 parts', async () => {
    const { secp256k1 } = await import('@noble/curves/secp256k1.js');
    const key = deriveEvm(TEST_MNEMONIC);
    const signer = createEvmSigner(key.privateKey);
    const digest = new Uint8Array(32).fill(9);

    const parts = await signer.signRaw(digest);
    // `format: 'recovered'` expects [recovery, r, s].
    const recovered = new Uint8Array(65);
    recovered[0] = parts.v;
    recovered.set(Buffer.from(parts.r.slice(2), 'hex'), 1);
    recovered.set(Buffer.from(parts.s.slice(2), 'hex'), 33);

    expect(parts.v).toBeLessThanOrEqual(1);
    expect(secp256k1.verify(recovered, digest, key.publicKey, { format: 'recovered' })).toBe(true);
    signer.destroy();
  });

  it('rejects a digest of the wrong length', async () => {
    const signer = createEvmSigner(deriveEvm(TEST_MNEMONIC).privateKey);

    await expect(signer.signRaw(new Uint8Array(31))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    signer.destroy();
  });
});

describe('signTransaction', () => {
  it('signs a legacy transaction into raw hex', async () => {
    const signer = createEvmSigner(deriveEvm(TEST_MNEMONIC).privateKey);

    const signed = await signer.signTransaction(LEGACY_TX);

    expect(signed.startsWith('0x')).toBe(true);
    expect(signed).toMatch(/^0x(?:f8|f86)[0-9a-f]+$/);
    expect(await recoveredSigner(signed)).toBe(signer.address);
    signer.destroy();
  });

  it('signs an EIP-1559 transaction into raw hex', async () => {
    const signer = createEvmSigner(deriveEvm(TEST_MNEMONIC).privateKey);

    const signed = await signer.signTransaction(EIP1559_TX);

    expect(signed.startsWith('0x02')).toBe(true);
    expect(await recoveredSigner(signed)).toBe(signer.address);
    signer.destroy();
  });

  it('produces a different payload for a different nonce', async () => {
    const signer = createEvmSigner(deriveEvm(TEST_MNEMONIC).privateKey);

    const first = await signer.signTransaction(LEGACY_TX);
    const second = await signer.signTransaction({ ...LEGACY_TX, nonce: 1 });

    expect(first).not.toBe(second);
    signer.destroy();
  });

  it('survives the caller zeroing its own key buffer', async () => {
    const key = deriveEvm(TEST_MNEMONIC);
    const signer = createEvmSigner(key.privateKey);
    key.privateKey.fill(0);

    // The signer kept a copy, so signing still works and still recovers.
    const signed = await signer.signTransaction(LEGACY_TX);

    expect(await recoveredSigner(signed)).toBe(signer.address);
    signer.destroy();
  });
});
