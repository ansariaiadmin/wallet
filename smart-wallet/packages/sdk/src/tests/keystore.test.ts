import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartWallet, SdkError } from '../index';
import { MemoryKeyStore, deriveEvm, deriveSolana, deriveTron } from '@wallet/keys';

const PASSWORD = 'correct horse battery staple';
const WRONG_PASSWORD = 'not the password';
const PASSPHRASE = 'twenty-fifth-word';

/** BIP-39 test vector already proven in P2 and P13. */
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

const EVM_RECIPIENT = '0x00000000219ab540356cBB839Cbe05303d7705Fa';
const SOL_RECIPIENT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/** A wallet whose phrase is known, loaded from the P13 keystore. */
async function keystoreWallet(
  options: { passphrase?: string; id?: string; store?: boolean } = {},
): Promise<{ wallet: SmartWallet; store: MemoryKeyStore }> {
  const store = new MemoryKeyStore();
  if (options.store !== false) {
    await store.store(options.id ?? 'default', TEST_MNEMONIC, PASSWORD);
  }
  const wallet = new SmartWallet({
    keystore: store,
    ...(options.id === undefined ? {} : { keystoreId: options.id }),
  });
  const imported = await wallet.import(TEST_MNEMONIC, PASSWORD, options.passphrase);
  expect(imported.address.evm).toBe(
    deriveEvm(
      TEST_MNEMONIC,
      0,
      options.passphrase === undefined ? {} : { passphrase: options.passphrase },
    ).address,
  );
  return { wallet, store };
}

/** Signs an EVM native transfer through the keystore path. */
function signEvm(wallet: SmartWallet, from: string, password = PASSWORD): Promise<string> {
  return wallet
    .buildAndSign({
      network: 'ethereum',
      type: 'native',
      from,
      to: EVM_RECIPIENT,
      amount: '250000000000000000',
      password,
    })
    .then((result) => result.signedTx as string);
}

/** Signs a Solana native transfer through the keystore path. */
function signSolana(wallet: SmartWallet, from: string, password = PASSWORD): Promise<Uint8Array> {
  return wallet
    .buildAndSign({
      network: 'solana',
      type: 'native',
      from,
      to: SOL_RECIPIENT,
      amount: '1500000000',
      password,
    })
    .then((result) => result.signedTx as Uint8Array);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SmartWallet with a KeyStore', () => {
  it('derives the same EVM address as the P13 package', async () => {
    const { wallet } = await keystoreWallet();

    // `import()` reports the core-derived address; the keystore path derives
    // with the P13 package, so the two must agree for signing to be usable.
    const created = await wallet.import(TEST_MNEMONIC, PASSWORD);
    expect(created.address.evm).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    expect(deriveEvm(TEST_MNEMONIC).address).toBe(created.address.evm);
    expect(deriveSolana(TEST_MNEMONIC).address).toBe(created.address.solana);
    expect(deriveTron(TEST_MNEMONIC).address).toBe(created.address.tron);
  });

  it('signs an EVM transfer into EIP-1559 RLP hex', async () => {
    const { wallet } = await keystoreWallet();

    const signed = await signEvm(wallet, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');

    expect(signed.startsWith('0x02')).toBe(true);
    expect(signed.length).toBeGreaterThan(100);
  });

  it('signs a Solana transfer into serialized bytes', async () => {
    const { wallet } = await keystoreWallet();

    const signed = await signSolana(wallet, deriveSolana(TEST_MNEMONIC).address);

    expect(signed).toBeInstanceOf(Uint8Array);
    expect(signed.length).toBeGreaterThan(100);
  });

  it('produces the same payload as the core signing path', async () => {
    const { wallet } = await keystoreWallet();
    const from = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
    const viaKeystore = await signEvm(wallet, from);

    // Same phrase, same path, deterministic (RFC-6979) signing: the core path
    // and the P13 path must agree byte for byte.
    const coreWallet = new SmartWallet();
    await coreWallet.import(TEST_MNEMONIC, PASSWORD);
    const viaCore = (
      await coreWallet.buildAndSign({
        network: 'ethereum',
        type: 'native',
        from,
        to: EVM_RECIPIENT,
        amount: '250000000000000000',
        password: PASSWORD,
      })
    ).signedTx as string;

    expect(viaKeystore).toBe(viaCore);
  });

  it('uses the BIP-39 passphrase the wallet was loaded with', async () => {
    const plain = await keystoreWallet();
    const withPassphrase = await keystoreWallet({ passphrase: PASSPHRASE });

    const one = await signEvm(plain.wallet, deriveEvm(TEST_MNEMONIC).address);
    const two = await signEvm(
      withPassphrase.wallet,
      deriveEvm(TEST_MNEMONIC, 0, { passphrase: PASSPHRASE }).address,
    );

    expect(one).not.toBe(two);
  });

  it('reads the phrase from a caller-chosen id', async () => {
    const { wallet } = await keystoreWallet({ id: 'wallet-secondary' });

    expect(await signEvm(wallet, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94')).toMatch(/^0x02/);
  });

  it('reports a wrong password as SdkError LOCKED', async () => {
    const { wallet } = await keystoreWallet();

    await expect(
      signEvm(wallet, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94', WRONG_PASSWORD),
    ).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('reports a missing entry as SdkError LOCKED', async () => {
    const { wallet } = await keystoreWallet({ store: false, id: 'never-stored' });

    await expect(
      signEvm(wallet, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'),
    ).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('still signs through the core path when no keystore is configured', async () => {
    const wallet = new SmartWallet();
    const imported = await wallet.import(TEST_MNEMONIC, PASSWORD);

    const signed = await wallet.buildAndSign({
      network: 'ethereum',
      type: 'native',
      from: imported.address.evm,
      to: EVM_RECIPIENT,
      amount: '250000000000000000',
      password: PASSWORD,
    });

    expect(String(signed.signedTx).startsWith('0x02')).toBe(true);
  });

  it('signs from the keystore even when no wallet was created on the SDK', async () => {
    const store = new MemoryKeyStore();
    await store.store('default', TEST_MNEMONIC, PASSWORD);
    const wallet = new SmartWallet({ keystore: store });

    const signed = await signEvm(wallet, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');

    expect(signed.startsWith('0x02')).toBe(true);
  });

  it('rejects signing before a keystore holds a phrase, with SdkError', async () => {
    const store = new MemoryKeyStore();
    const wallet = new SmartWallet({ keystore: store });

    await expect(
      signEvm(wallet, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'),
    ).rejects.toBeInstanceOf(SdkError);
  });
});
