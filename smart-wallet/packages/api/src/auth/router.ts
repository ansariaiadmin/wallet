/**
 * `/auth` endpoints: register, login, me, logout.
 *
 * Registering creates a user *and* a wallet: the wallet id is minted here and
 * handed to the caller inside the token, so every later wallet call can name
 * the wallet it means. When a {@link KeyStore} is configured, the mnemonic for
 * that wallet is generated and stored encrypted at the same time and returned
 * **once**, in the registration answer — there is no endpoint that hands it out
 * again, by design.
 *
 * `me` and `logout` sit behind {@link requireAuth}; `register` and `login` are
 * public. The wallet endpoints (`/quote`, `/build`, `/broadcast`) stay public
 * in this phase.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { generate, type KeyStore } from '@wallet/keys';
import { ApiError } from '../errors';
import {
  DUMMY_HASH,
  hashPassword,
  requirePassword,
  requireUsername,
  verifyPassword,
  type UserStore,
} from './user-store';
import { DEFAULT_EXPIRES_IN, signToken, TokenRevocation, type TokenPayload } from './jwt';
import { requireAuth, type AuthEnv } from './middleware';

/** What the auth endpoints need from the caller. */
export interface AuthDeps {
  /** Where users live. */
  readonly userStore: UserStore;
  /** Secret the tokens are signed with and verified against. */
  readonly secret: Uint8Array;
  /** Optional encrypted mnemonic store; when set, registering mints a wallet. */
  readonly keystore?: KeyStore;
  /** Logout list; a token on it is refused from then on. */
  readonly revoked?: TokenRevocation;
  /** How long a token lives. Defaults to {@link DEFAULT_EXPIRES_IN}. */
  readonly expiresIn?: string | number;
}

/** The body of `POST /auth/register` and `POST /auth/login`. */
interface Credentials {
  readonly username?: unknown;
  readonly password?: unknown;
}

/** A user as the API reports it: never the password hash. */
interface PublicUser {
  readonly id: string;
  readonly username: string;
  /** Every wallet the user owns, oldest first. */
  readonly walletIds: readonly string[];
  readonly createdAt: string;
}

/** The body of `POST /auth/wallets`. */
interface WalletRequest {
  readonly label?: unknown;
  readonly password?: unknown;
}

/** A wallet id: the key the encrypted mnemonic is stored under. */
function newWalletId(): string {
  return `wallet_${randomUUID()}`;
}

/** Builds the `/auth` router. */
export function authRoutes(deps: AuthDeps): Hono<AuthEnv> {
  const revoked = deps.revoked ?? new TokenRevocation();
  const router = new Hono<AuthEnv>();

  router.post('/auth/register', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Credentials;
    const username = requireUsername(String(body.username ?? ''));
    const password = requirePassword(String(body.password ?? ''));

    // Checked before the (deliberately slow) hashing, so a taken name answers
    // without paying for scrypt twice.
    if ((await deps.userStore.findByUsername(username)) !== null) {
      throw new ApiError(409, 'USERNAME_TAKEN', `username "${username}" is already registered`);
    }

    const passwordHash = await hashPassword(password);
    const walletId = newWalletId();
    const user = await deps.userStore.create(username, passwordHash, walletId);

    // The keystore is optional: without one the wallet is an id the caller can
    // bind a key to later, and no key material is created here at all.
    let mnemonic: string | undefined;
    if (deps.keystore !== undefined) {
      mnemonic = generate();
      await deps.keystore.store(walletId, mnemonic, password);
    }

    const token = await issue(deps, user);
    return c.json(
      {
        token,
        expiresIn: deps.expiresIn ?? DEFAULT_EXPIRES_IN,
        user: publicUser(user),
        ...(mnemonic === undefined ? {} : { mnemonic }),
      },
      201,
    );
  });

  // Mints another wallet for the caller. `POST /auth/wallets` rather than
  // `POST /wallets` because it belongs to the same secret-free surface: no
  // password is asked for again, and the token is what authorises the mint.
  router.post('/auth/wallets', requireAuth(deps.secret, revoked), async (c) => {
    const caller = c.get('user');
    if (caller === undefined) {
      throw new ApiError(401, 'UNAUTHORIZED', 'a valid token is required');
    }

    const body = (await c.req.json().catch(() => ({}))) as WalletRequest;
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 64) : '';

    // A keystore-backed instance needs the password again: encrypting a new
    // phrase needs the secret, and a bearer token deliberately does not carry
    // one. Asking for it here is the price of not caching it.
    let password: string | undefined;
    if (deps.keystore !== undefined) {
      password = requirePassword(String(body.password ?? ''));
    }

    const walletId = newWalletId();
    await deps.userStore.addWallet(caller.userId, walletId, label);

    let mnemonic: string | undefined;
    if (deps.keystore !== undefined && password !== undefined) {
      mnemonic = generate();
      await deps.keystore.store(walletId, mnemonic, password);
    }

    return c.json(
      {
        walletId,
        label,
        createdAt: (await deps.userStore.findWallet(walletId))?.createdAt ?? '',
        ...(mnemonic === undefined ? {} : { mnemonic }),
      },
      201,
    );
  });

  router.get('/auth/wallets', requireAuth(deps.secret, revoked), async (c) => {
    const caller = c.get('user');
    if (caller === undefined) {
      throw new ApiError(401, 'UNAUTHORIZED', 'a valid token is required');
    }

    const wallets = await deps.userStore.wallets(caller.userId);
    return c.json(
      {
        wallets: wallets.map((wallet) => ({
          walletId: wallet.walletId,
          label: wallet.label,
          createdAt: wallet.createdAt,
        })),
      },
      200,
    );
  });

  router.post('/auth/login', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Credentials;
    const username = requireUsername(String(body.username ?? ''));
    const password = requirePassword(String(body.password ?? ''));

    const user = await deps.userStore.findByUsername(username);
    // Both branches run scrypt, so the answer time does not reveal whether the
    // username exists.
    const hash = user?.passwordHash ?? (await DUMMY_HASH);
    const ok = await verifyPassword(password, hash);
    if (user === null || !ok) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'username or password is incorrect');
    }

    const token = await issue(deps, user);
    return c.json(
      { token, expiresIn: deps.expiresIn ?? DEFAULT_EXPIRES_IN, user: publicUser(user) },
      200,
    );
  });

  router.get('/auth/me', requireAuth(deps.secret, revoked), (c) => {
    const payload: TokenPayload = c.get('user');
    return c.json({ user: { userId: payload.userId, walletIds: payload.walletIds } }, 200);
  });

  router.delete('/auth/logout', requireAuth(deps.secret, revoked), (c) => {
    // The payload carries the expiry, so the revoked id is only remembered for
    // as long as the token could still have been used.
    revoked.revoke(c.get('user'));
    return c.body(null, 204);
  });

  return router;
}

/** Signs a token for a user, minting the id the logout list revokes by. */
async function issue(
  deps: AuthDeps,
  user: {
    id: string;
    walletIds: readonly string[];
  },
): Promise<string> {
  const payload: TokenPayload = {
    userId: user.id,
    walletIds: [...user.walletIds],
    jti: randomUUID(),
  };
  return signToken(payload, deps.secret, deps.expiresIn ?? DEFAULT_EXPIRES_IN);
}

/** Strips everything a caller must not see. */
function publicUser(user: {
  id: string;
  username: string;
  walletIds: readonly string[];
  createdAt: string;
}): PublicUser {
  return {
    id: user.id,
    username: user.username,
    walletIds: [...user.walletIds],
    createdAt: user.createdAt,
  };
}
