import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileKeyStore } from '../../keystores/file';
import { KeyStoreError } from '../../types';

const PASSPHRASE = 'correct horse battery staple';
const WRONG_PASSPHRASE = 'not the passphrase';
const ID = 'wallet-main';

/** The BIP-39 reference phrase, validated by the P13 suite. */
const MNEMONIC = [
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

/** A unique temp directory per test; removed again afterwards. */
let dir = '';

async function tempDir(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'wallet-keys-'));
  return dir;
}

afterEach(async () => {
  if (dir !== '') {
    await rm(dir, { recursive: true, force: true });
    dir = '';
  }
});

describe('FileKeyStore.store / load', () => {
  it('round-trips a mnemonic through disk', async () => {
    const store = new FileKeyStore(await tempDir());

    await store.store(ID, MNEMONIC, PASSPHRASE);

    expect(await store.load(ID, PASSPHRASE)).toBe(MNEMONIC);
    expect(await store.has(ID)).toBe(true);
  });

  it('round-trips without a passphrase', async () => {
    const store = new FileKeyStore(await tempDir());

    await store.store(ID, MNEMONIC);

    expect(await store.load(ID)).toBe(MNEMONIC);
  });

  it('normalizes the phrase it stores', async () => {
    const store = new FileKeyStore(await tempDir());

    await store.store(ID, `  ${MNEMONIC.toUpperCase()}  `, PASSPHRASE);

    expect(await store.load(ID, PASSPHRASE)).toBe(MNEMONIC);
  });

  it('writes an encrypted blob, never the plaintext', async () => {
    const store = new FileKeyStore(await tempDir());

    await store.store(ID, MNEMONIC, PASSPHRASE);
    const raw = await readFile(join(dir, `${ID}.enc`), 'utf8');

    expect(raw).not.toContain('abandon');
    const blob = JSON.parse(raw) as { cipher: string; kdf: string };
    expect(blob.cipher).toBe('aes-256-gcm');
    expect(blob.kdf).toBe('pbkdf2');
  });

  it('creates the file with owner-only permissions', async () => {
    const store = new FileKeyStore(join(await tempDir(), 'nested'));

    await store.store(ID, MNEMONIC, PASSPHRASE);
    const info = await stat(join(dir, 'nested', `${ID}.enc`));

    expect(info.mode & 0o777).toBe(0o600);
  });

  it('creates a directory that does not exist yet', async () => {
    const store = new FileKeyStore(join(await tempDir(), 'a', 'b', 'c'));

    await store.store(ID, MNEMONIC, PASSPHRASE);

    expect(await store.has(ID)).toBe(true);
  });

  it('overwrites what an id already holds', async () => {
    const store = new FileKeyStore(await tempDir());
    const other = [
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
    await store.store(ID, MNEMONIC, PASSPHRASE);

    await store.store(ID, other, PASSPHRASE);

    expect(await store.load(ID, PASSPHRASE)).toBe(other);
  });

  it('keeps two ids apart', async () => {
    const store = new FileKeyStore(await tempDir());
    const other = [
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
    await store.store('a', MNEMONIC, PASSPHRASE);
    await store.store('b', other, PASSPHRASE);

    expect(await store.load('a', PASSPHRASE)).toBe(MNEMONIC);
    expect(await store.load('b', PASSPHRASE)).toBe(other);
  });

  it('rejects an invalid mnemonic and writes nothing', async () => {
    const store = new FileKeyStore(await tempDir());

    await expect(store.store(ID, 'not a valid bip39 phrase', PASSPHRASE)).rejects.toMatchObject({
      code: 'INVALID_MNEMONIC',
    });
    expect(await store.has(ID)).toBe(false);
  });
});

describe('FileKeyStore.load failures', () => {
  it('reports a wrong passphrase as WRONG_PASSWORD', async () => {
    const store = new FileKeyStore(await tempDir());
    await store.store(ID, MNEMONIC, PASSPHRASE);

    await expect(store.load(ID, WRONG_PASSPHRASE)).rejects.toMatchObject({
      code: 'WRONG_PASSWORD',
    });
  });

  it('reports an unknown id as NOT_FOUND', async () => {
    const store = new FileKeyStore(await tempDir());

    await expect(store.load('missing', PASSPHRASE)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports a corrupt file as a KeyStoreError', async () => {
    const store = new FileKeyStore(await tempDir());
    await store.store(ID, MNEMONIC, PASSPHRASE);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, `${ID}.enc`), 'not json at all', 'utf8');

    await expect(store.load(ID, PASSPHRASE)).rejects.toBeInstanceOf(KeyStoreError);
  });

  it('reports a file that is not a blob as INVALID_INPUT', async () => {
    const store = new FileKeyStore(await tempDir());
    await store.store(ID, MNEMONIC, PASSPHRASE);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, `${ID}.enc`), '{"version":9}', 'utf8');

    await expect(store.load(ID, PASSPHRASE)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('FileKeyStore.remove', () => {
  it('deletes the blob and forgets the id', async () => {
    const store = new FileKeyStore(await tempDir());
    await store.store(ID, MNEMONIC, PASSPHRASE);

    await store.remove(ID);

    expect(await store.has(ID)).toBe(false);
    await expect(store.load(ID, PASSPHRASE)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports removing an unknown id as NOT_FOUND', async () => {
    const store = new FileKeyStore(await tempDir());

    await expect(store.remove('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps the other ids when one is removed', async () => {
    const store = new FileKeyStore(await tempDir());
    await store.store('a', MNEMONIC, PASSPHRASE);
    await store.store('b', MNEMONIC, PASSPHRASE);

    await store.remove('a');

    expect(await store.has('b')).toBe(true);
  });
});

describe('FileKeyStore.has', () => {
  it('is false for an id that was never stored', async () => {
    const store = new FileKeyStore(await tempDir());

    expect(await store.has('missing')).toBe(false);
  });
});

describe('FileKeyStore id sanitization', () => {
  it('accepts letters, digits, underscores and dashes', async () => {
    const store = new FileKeyStore(await tempDir());

    await store.store('wallet_2-main', MNEMONIC, PASSPHRASE);

    expect(await store.has('wallet_2-main')).toBe(true);
  });

  it('rejects a path traversal attempt', async () => {
    const store = new FileKeyStore(await tempDir());

    await expect(store.store('../etc/passwd', MNEMONIC, PASSPHRASE)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(store.load('../../etc/passwd', PASSPHRASE)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(store.has('..')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.remove('../outside')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects an empty id and one that is too long', async () => {
    const store = new FileKeyStore(await tempDir());

    await expect(store.store('', MNEMONIC, PASSPHRASE)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(store.store('x'.repeat(65), MNEMONIC, PASSPHRASE)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('rejects ids with a slash, a dot or a space', async () => {
    const store = new FileKeyStore(await tempDir());

    for (const id of ['a/b', 'a.b', 'a b', 'ünïcode']) {
      await expect(store.store(id, MNEMONIC, PASSPHRASE)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    }
  });

  it('rejects the same id in every method, and stores nothing', async () => {
    const store = new FileKeyStore(await tempDir());

    await expect(store.store('../escape', MNEMONIC, PASSPHRASE)).rejects.toThrow(KeyStoreError);
    // A rejected id is an error everywhere, never a silent "absent".
    await expect(store.has('../escape')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.load('../escape', PASSPHRASE)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(store.remove('../escape')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('KeyStoreError', () => {
  it('carries a code and a name', () => {
    const error = new KeyStoreError('nothing stored', 'NOT_FOUND');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('KeyStoreError');
    expect(error.code).toBe('NOT_FOUND');
  });
});
