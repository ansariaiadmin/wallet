/**
 * Users and their password hashes.
 *
 * The store keeps a **hash**, never the password: `scrypt` from `node:crypto`
 * with N=16384, r=8, p=1 and a per-user random salt, encoded as
 * `scrypt$N$r$p$salt$hash` so the parameters travel with the hash and can be
 * raised later without invalidating existing accounts.
 *
 * `scrypt` is memory-hard, needs no native addon and runs in a worker-friendly
 * async form, which is what makes it usable in tests — unlike bcrypt, which is
 * both slower and a native dependency.
 */

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { ApiError } from '../errors';

/**
 * `scrypt` in promise form.
 *
 * Written out rather than `promisify`d so the options object stays visible in
 * the types: the cost parameters are the whole point of using scrypt.
 */
function derive(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/** scrypt cost parameters. Memory ≈ N * r * 128 bytes ≈ 16 MiB. */
export const SCRYPT_N = 16_384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
/** Derived hash length in bytes. */
export const KEY_LENGTH = 32;
/** Salt length in bytes. */
export const SALT_LENGTH = 16;

/** A user as the store keeps it. `passwordHash` never leaves this module. */
export interface User {
  readonly id: string;
  readonly username: string;
  /** `scrypt$N$r$p$salt$hash`, all hex. */
  readonly passwordHash: string;
  /** Every wallet this user owns. Never empty once `create` has returned. */
  readonly walletIds: readonly string[];
  /** ISO timestamp of the registration. */
  readonly createdAt: string;
}

/**
 * A wallet a user owns.
 *
 * Separate from `User` because a user owns *many* of them, and because the
 * record that names a wallet is not the record that authenticates its owner.
 */
export interface WalletRecord {
  /** The wallet id, and the key the encrypted mnemonic is stored under. */
  readonly walletId: string;
  /** The user who owns it. */
  readonly userId: string;
  /** A label the owner chose; empty when they did not. */
  readonly label: string;
  /** ISO timestamp the wallet was created. */
  readonly createdAt: string;
}

/** Storage for users, keyed by username and by id. */
export interface UserStore {
  /** Creates a user; throws when the username is taken. */
  create(username: string, passwordHash: string, walletId: string): Promise<User>;
  /** The user with `username`, or `null`. */
  findByUsername(username: string): Promise<User | null>;
  /** The user with `id`, or `null`. */
  findById(id: string): Promise<User | null>;
  /** Adds a wallet to a user; throws when the id is already taken. */
  addWallet(userId: string, walletId: string, label?: string): Promise<WalletRecord>;
  /** Every wallet a user owns, oldest first. */
  wallets(userId: string): Promise<readonly WalletRecord[]>;
  /** The wallet with `walletId`, or `null`. */
  findWallet(walletId: string): Promise<WalletRecord | null>;
}

/** In-memory {@link UserStore}: no persistence, no I/O. */
export class MemoryUserStore implements UserStore {
  private readonly byUsername = new Map<string, User>();
  private readonly byId = new Map<string, User>();
  private readonly byWalletId = new Map<string, WalletRecord>();

  async create(username: string, passwordHash: string, walletId: string): Promise<User> {
    const name = requireUsername(username);
    if (this.byUsername.has(name)) {
      throw new ApiError(409, 'USERNAME_TAKEN', `username "${name}" is already registered`);
    }
    // The first wallet is created with the user, so a user always owns at least
    // one and `wallets()` is never empty for a user that exists.
    const userId = `user_${randomBytes(8).toString('hex')}`;
    const record = this.remember(userId, walletId, '');
    const user: User = {
      id: userId,
      username: name,
      passwordHash,
      walletIds: [record.walletId],
      createdAt: record.createdAt,
    };
    this.byUsername.set(name, user);
    this.byId.set(user.id, user);
    return user;
  }

  /**
   * Registers a wallet against an already-created user.
   *
   * Split out because `create` needs a user id before it has a user object, and
   * because the id-taken check belongs in exactly one place.
   */
  private remember(userId: string, walletId: string, label: string): WalletRecord {
    const record: WalletRecord = {
      walletId,
      userId,
      label,
      createdAt: new Date().toISOString(),
    };
    this.byWalletId.set(walletId, record);
    return record;
  }

  async addWallet(userId: string, walletId: string, label = ''): Promise<WalletRecord> {
    const user = this.byId.get(userId);
    if (user === undefined) {
      throw new ApiError(404, 'NOT_FOUND', 'no such user');
    }
    if (this.byWalletId.has(walletId)) {
      throw new ApiError(409, 'WALLET_TAKEN', 'that wallet id is already registered');
    }
    const record = this.remember(userId, walletId, label);
    this.byId.set(userId, { ...user, walletIds: [...user.walletIds, walletId] });
    return record;
  }

  async wallets(userId: string): Promise<readonly WalletRecord[]> {
    const user = this.byId.get(userId);
    if (user === undefined) {
      return [];
    }
    return user.walletIds
      .map((walletId) => this.byWalletId.get(walletId))
      .filter((record): record is WalletRecord => record !== undefined);
  }

  async findWallet(walletId: string): Promise<WalletRecord | null> {
    return this.byWalletId.get(walletId) ?? null;
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.byUsername.get(requireUsername(username)) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }

  /** How many users are registered. */
  get size(): number {
    return this.byId.size;
  }

  /** Forgets every user and every wallet. */
  clear(): void {
    this.byUsername.clear();
    this.byId.clear();
    this.byWalletId.clear();
  }
}

/** Hashes a password with a fresh random salt. */
export async function hashPassword(password: string): Promise<string> {
  requirePassword(password);
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('hex'), hash.toString('hex')].join(
    '$',
  );
}

/** Whether `password` matches a hash produced by {@link hashPassword}. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, n, r, p, saltHex, hashHex] = parts;
  if (
    n === undefined ||
    r === undefined ||
    p === undefined ||
    saltHex === undefined ||
    hashHex === undefined
  ) {
    return false;
  }
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  const actual = await derive(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Rejects a username the store cannot key on. */
export function requireUsername(username: string): string {
  if (typeof username !== 'string' || username.trim() === '') {
    throw new ApiError(400, 'INVALID_INPUT', 'username is required');
  }
  const name = username.trim();
  if (name.length < 3 || name.length > 32 || !/^[\w.-]+$/.test(name)) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      'username must be 3-32 characters of letters, digits, "_", "." or "-"',
    );
  }
  return name;
}

/** Rejects a password that is too weak to hash. */
export function requirePassword(password: string): string {
  if (typeof password !== 'string' || password.length < 8) {
    throw new ApiError(400, 'INVALID_INPUT', 'password must be at least 8 characters');
  }
  return password;
}

/**
 * A fixed hash to compare against when the username does not exist.
 *
 * Without it, a login for an unknown name would answer faster than one for a
 * known name, and the difference is a user-enumeration oracle.
 */
export const DUMMY_HASH: Promise<string> = hashPassword('timing-equalizer-password');
