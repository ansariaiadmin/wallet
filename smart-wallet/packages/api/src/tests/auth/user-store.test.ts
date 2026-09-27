import { describe, expect, it } from 'vitest';
import {
  DUMMY_HASH,
  hashPassword,
  MemoryUserStore,
  requirePassword,
  requireUsername,
  verifyPassword,
} from '../../auth/user-store';
import { ApiError } from '../../errors';

const PASSWORD = 'correct horse battery staple';
const OTHER_PASSWORD = 'another password entirely';

describe('MemoryUserStore', () => {
  it('creates a user and finds it by username and by id', async () => {
    const store = new MemoryUserStore();

    const user = await store.create('alice', await hashPassword(PASSWORD), 'wallet_1');

    expect(user.username).toBe('alice');
    expect(user.walletId).toBe('wallet_1');
    expect(user.id).toMatch(/^user_[0-9a-f]{16}$/);
    expect(user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await store.findByUsername('alice'))?.id).toBe(user.id);
    expect((await store.findById(user.id))?.username).toBe('alice');
  });

  it('gives every user a distinct id', async () => {
    const store = new MemoryUserStore();
    const one = await store.create('alice', await hashPassword(PASSWORD), 'wallet_1');
    const two = await store.create('bob', await hashPassword(PASSWORD), 'wallet_2');

    expect(one.id).not.toBe(two.id);
    expect(store.size).toBe(2);
  });

  it('refuses a duplicate username with 409', async () => {
    const store = new MemoryUserStore();
    await store.create('alice', await hashPassword(PASSWORD), 'wallet_1');

    await expect(
      store.create('alice', await hashPassword(OTHER_PASSWORD), 'wallet_2'),
    ).rejects.toMatchObject({ status: 409, code: 'USERNAME_TAKEN' });
  });

  it('keeps the first user when a duplicate is refused', async () => {
    const store = new MemoryUserStore();
    await store.create('alice', await hashPassword(PASSWORD), 'wallet_1');

    await expect(store.create('alice', 'x', 'wallet_2')).rejects.toBeInstanceOf(ApiError);
    const stored = await store.findByUsername('alice');
    expect(stored?.walletId).toBe('wallet_1');
  });

  it('returns null for an unknown username and id', async () => {
    const store = new MemoryUserStore();

    expect(await store.findByUsername('nobody')).toBeNull();
    expect(await store.findById('user_missing')).toBeNull();
  });

  it('trims the username it keys on', async () => {
    const store = new MemoryUserStore();
    await store.create('alice', await hashPassword(PASSWORD), 'wallet_1');

    expect((await store.findByUsername('  alice  '))?.username).toBe('alice');
  });

  it('forgets everything on clear()', async () => {
    const store = new MemoryUserStore();
    await store.create('alice', await hashPassword(PASSWORD), 'wallet_1');

    store.clear();

    expect(store.size).toBe(0);
    expect(await store.findByUsername('alice')).toBeNull();
  });
});

describe('hashPassword / verifyPassword', () => {
  it('verifies the password it hashed', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
  });

  it('rejects a different password', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(OTHER_PASSWORD, hash)).toBe(false);
  });

  it('never stores the password itself', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).not.toContain(PASSWORD);
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(hash.split('$')).toHaveLength(6);
  });

  it('uses a different salt for the same password', async () => {
    const one = await hashPassword(PASSWORD);
    const two = await hashPassword(PASSWORD);

    expect(one).not.toBe(two);
    expect(await verifyPassword(PASSWORD, one)).toBe(true);
    expect(await verifyPassword(PASSWORD, two)).toBe(true);
  });

  it('rejects a hash that is not a scrypt hash', async () => {
    expect(await verifyPassword(PASSWORD, 'nonsense')).toBe(false);
    expect(await verifyPassword(PASSWORD, 'scrypt$16384$8$1$aa$bb')).toBe(false);
    expect(await verifyPassword(PASSWORD, 'scrypt$16384$8$1$$')).toBe(false);
  });

  it('keeps a dummy hash usable for timing equalisation', async () => {
    expect(await verifyPassword(PASSWORD, await DUMMY_HASH)).toBe(false);
  });
});

describe('input validation', () => {
  it('accepts a sane username', () => {
    expect(requireUsername('alice')).toBe('alice');
    expect(requireUsername('alice.smith-1_x')).toBe('alice.smith-1_x');
  });

  it('rejects a username that is empty, short, long or odd', () => {
    for (const bad of ['', '  ', 'ab', 'x'.repeat(33), 'alice smith', 'alice/smith', 'алиса']) {
      expect(() => requireUsername(bad)).toThrow(ApiError);
    }
  });

  it('rejects a short password', () => {
    expect(requirePassword(PASSWORD)).toBe(PASSWORD);
    expect(() => requirePassword('short')).toThrow(ApiError);
    expect(() => requirePassword(undefined as never)).toThrow(ApiError);
  });
});
