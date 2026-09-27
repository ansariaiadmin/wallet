import { describe, expect, it } from 'vitest';
import { MemoryKeyStore } from '../src/keystore';
import { KeyStoreError } from '../src/types';
import { generate } from '../src/mnemonic';

const PASSPHRASE = 'correct horse battery staple';
const OTHER_PASSPHRASE = 'another secret';
const ID = 'wallet-main';

/** A store with one phrase already stored under {@link ID}. */
async function seeded(passphrase?: string): Promise<MemoryKeyStore> {
  const store = new MemoryKeyStore();
  await store.store(ID, generate(), passphrase);
  return store;
}

describe('MemoryKeyStore.store', () => {
  it('stores a mnemonic that can be read back', async () => {
    const store = new MemoryKeyStore();
    const mnemonic = generate();

    await store.store(ID, mnemonic, PASSPHRASE);

    expect(await store.load(ID, PASSPHRASE)).toBe(mnemonic);
    expect(await store.has(ID)).toBe(true);
  });

  it('works without a passphrase', async () => {
    const store = new MemoryKeyStore();
    const mnemonic = generate();

    await store.store(ID, mnemonic);

    expect(await store.load(ID)).toBe(mnemonic);
  });

  it('normalizes the phrase it stores', async () => {
    const store = new MemoryKeyStore();
    const mnemonic = generate();

    await store.store(ID, `  ${mnemonic.toUpperCase()}  `);

    expect(await store.load(ID)).toBe(mnemonic);
  });

  it('rejects an invalid mnemonic and stores nothing', async () => {
    const store = new MemoryKeyStore();

    await expect(store.store(ID, 'not a valid bip39 phrase', PASSPHRASE)).rejects.toMatchObject({
      code: 'INVALID_MNEMONIC',
    });
    expect(await store.has(ID)).toBe(false);
  });

  it('rejects an empty id', async () => {
    const store = new MemoryKeyStore();

    await expect(store.store('  ', generate(), PASSPHRASE)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('replaces what an id already holds', async () => {
    const store = new MemoryKeyStore();
    const first = generate();
    const second = generate();
    await store.store(ID, first, PASSPHRASE);

    await store.store(ID, second, PASSPHRASE);

    expect(await store.load(ID, PASSPHRASE)).toBe(second);
    expect(store.size).toBe(1);
  });

  it('keeps two ids apart', async () => {
    const store = new MemoryKeyStore();
    const first = generate();
    const second = generate();
    await store.store('a', first, PASSPHRASE);
    await store.store('b', second, PASSPHRASE);

    expect(await store.load('a', PASSPHRASE)).toBe(first);
    expect(await store.load('b', PASSPHRASE)).toBe(second);
    expect(store.size).toBe(2);
    expect(store.ids().sort()).toEqual(['a', 'b']);
  });

  it('does not keep the plaintext in the map', async () => {
    const store = new MemoryKeyStore();
    const mnemonic = generate();
    await store.store(ID, mnemonic, PASSPHRASE);

    const dump = JSON.stringify(store.ids());
    expect(dump).not.toContain(mnemonic);
  });
});

describe('MemoryKeyStore.load', () => {
  it('rejects a wrong passphrase with WRONG_PASSWORD', async () => {
    const store = await seeded(PASSPHRASE);

    await expect(store.load(ID, OTHER_PASSPHRASE)).rejects.toMatchObject({
      code: 'WRONG_PASSWORD',
    });
  });

  it('rejects a missing passphrase when one was used', async () => {
    const store = await seeded(PASSPHRASE);

    await expect(store.load(ID)).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
  });

  it('throws LOCKED for an unknown id', async () => {
    const store = new MemoryKeyStore();

    await expect(store.load('missing', PASSPHRASE)).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('throws after the entry was removed', async () => {
    const store = await seeded(PASSPHRASE);
    await store.remove(ID);

    await expect(store.load(ID, PASSPHRASE)).rejects.toMatchObject({ code: 'LOCKED' });
    expect(await store.has(ID)).toBe(false);
  });

  it('rejects an empty id', async () => {
    const store = await seeded(PASSPHRASE);

    await expect(store.load('', PASSPHRASE)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('MemoryKeyStore.remove', () => {
  it('forgets one id and keeps the rest', async () => {
    const store = new MemoryKeyStore();
    await store.store('a', generate(), PASSPHRASE);
    await store.store('b', generate(), PASSPHRASE);

    await store.remove('a');

    expect(await store.has('a')).toBe(false);
    expect(await store.has('b')).toBe(true);
  });

  it('is silent for an unknown id', async () => {
    const store = new MemoryKeyStore();

    await expect(store.remove('nope')).resolves.toBeUndefined();
  });
});

describe('MemoryKeyStore.clear', () => {
  it('forgets everything', async () => {
    const store = new MemoryKeyStore();
    await store.store('a', generate(), PASSPHRASE);
    await store.store('b', generate(), PASSPHRASE);

    store.clear();

    expect(store.size).toBe(0);
    expect(store.ids()).toEqual([]);
  });
});

describe('KeyStoreError', () => {
  it('carries a code and a name', () => {
    const error = new KeyStoreError('locked', 'LOCKED');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('KeyStoreError');
    expect(error.code).toBe('LOCKED');
    expect(error.message).toBe('locked');
  });

  it('keeps the original error as cause', () => {
    const cause = new Error('auth tag mismatch');

    expect(new KeyStoreError('wrong password', 'WRONG_PASSWORD', cause).cause).toBe(cause);
  });
});
