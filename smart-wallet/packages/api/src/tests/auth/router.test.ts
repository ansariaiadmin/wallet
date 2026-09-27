import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { ApiError } from '../../errors';
import { MemoryUserStore } from '../../auth/user-store';
import { randomJwtSecret, TokenRevocation, verifyToken } from '../../auth/jwt';
import { RateLimiter } from '../../rate-limit';
import { FileKeyStore, MemoryKeyStore } from '@wallet/keys';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const USERNAME = 'alice';
const PASSWORD = 'correct horse battery staple';
const OTHER_PASSWORD = 'another password entirely';

/** A secret fixed for the test, so tokens survive across apps in one test. */
const SECRET = randomJwtSecret();

/** A store pre-loaded with nothing, so every test starts from a clean slate. */
function userStore(): MemoryUserStore {
  return new MemoryUserStore();
}

/** An app that is not rate limited: the auth tests fire many requests. */
function app(deps: Parameters<typeof createApp>[0] = {}): ReturnType<typeof createApp> {
  return createApp({
    userStore: userStore(),
    jwtSecret: SECRET,
    rateLimiter: new RateLimiter({ limit: Number.MAX_SAFE_INTEGER }),
    ...deps,
  });
}

/** Registers `username` and returns the answer. */
async function register(
  target = app(),
  password = PASSWORD,
  username = USERNAME,
): Promise<Response> {
  return target.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

/** The token out of a register or login answer. */
async function tokenOf(response: Response): Promise<string> {
  const body = (await response.json()) as { token?: string };
  expect(body.token).toBeTypeOf('string');
  return String(body.token);
}

/** `Authorization` header for a token. */
function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

let tmp = '';

afterEach(async () => {
  if (tmp !== '') {
    await rm(tmp, { recursive: true, force: true });
    tmp = '';
  }
});

describe('POST /auth/register', () => {
  it('creates a user and a wallet and answers 201 with a token', async () => {
    const response = await register();

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      token: string;
      user: { id: string; username: string; walletId: string };
    };
    expect(body.token.split('.')).toHaveLength(3);
    expect(body.user.username).toBe(USERNAME);
    expect(body.user.walletId).toMatch(/^wallet_[0-9a-f-]{36}$/);
    expect(body.user.id).toMatch(/^user_/);
  });

  it('never answers with the password hash', async () => {
    const response = await register();
    const text = await response.clone().text();

    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('scrypt');
  });

  it('puts the user and wallet in the token', async () => {
    const target = app();
    const body = (await (await register(target)).json()) as {
      token: string;
      user: { id: string; walletId: string };
    };
    const payload = await verifyToken(body.token, SECRET);

    expect(payload.userId).toBe(body.user.id);
    expect(payload.walletId).toBe(body.user.walletId);
  });

  it('rejects a duplicate username with 409', async () => {
    const target = app();
    await register(target);

    const again = await register(target);

    expect(again.status).toBe(409);
    expect((await again.json()) as { code: string }).toMatchObject({ code: 'USERNAME_TAKEN' });
  });

  it('rejects a missing password with 400', async () => {
    const response = await app().request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USERNAME }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()) as { code: string }).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects a missing username with 400', async () => {
    const response = await app().request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });

    expect(response.status).toBe(400);
  });

  it('rejects a short password with 400', async () => {
    const response = await register(app(), 'short');

    expect(response.status).toBe(400);
  });

  it('rejects a body that is not JSON', async () => {
    const response = await app().request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    expect(response.status).toBe(400);
  });

  it('stores an encrypted mnemonic when a keystore is configured', async () => {
    const keystore = new MemoryKeyStore();
    const target = app({ keystore });
    const response = await register(target);
    const body = (await response.json()) as { user: { walletId: string }; mnemonic: string };

    expect(body.mnemonic.split(' ')).toHaveLength(12);
    // The same phrase is readable back with the account password.
    expect(await keystore.load(body.user.walletId, PASSWORD)).toBe(body.mnemonic);
    await expect(keystore.load(body.user.walletId, OTHER_PASSWORD)).rejects.toMatchObject({
      code: 'WRONG_PASSWORD',
    });
  });

  it('omits the mnemonic when no keystore is configured', async () => {
    const body = (await (await register()).json()) as { mnemonic?: string };

    expect(body.mnemonic).toBeUndefined();
  });

  it('writes to a FileKeyStore when one is configured', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'wallet-api-auth-'));
    const keystore = new FileKeyStore(tmp);
    const body = (await (await register(app({ keystore }))).json()) as {
      user: { walletId: string };
      mnemonic: string;
    };

    expect(await keystore.load(body.user.walletId, PASSWORD)).toBe(body.mnemonic);
  });
});

describe('POST /auth/login', () => {
  it('answers 200 with a token for the right credentials', async () => {
    const target = app();
    await register(target);

    const response = await target.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string; user: { username: string } };
    expect(body.token.split('.')).toHaveLength(3);
    expect(body.user.username).toBe(USERNAME);
  });

  it('rejects a wrong password with 401', async () => {
    const target = app();
    await register(target);

    const response = await target.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: OTHER_PASSWORD }),
    });

    expect(response.status).toBe(401);
    expect((await response.json()) as { code: string }).toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('rejects an unknown username with 401', async () => {
    const response = await app().request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: PASSWORD }),
    });

    expect(response.status).toBe(401);
  });

  it('rejects a missing password with 400', async () => {
    const target = app();
    await register(target);

    const response = await target.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USERNAME }),
    });

    expect(response.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('answers 401 without a token', async () => {
    const response = await app().request('/api/v1/auth/me');

    expect(response.status).toBe(401);
  });

  it('answers 401 for a header that is not a bearer token', async () => {
    const target = app();
    const token = await tokenOf(await register(target));

    const response = await target.request('/api/v1/auth/me', {
      headers: { Authorization: token },
    });

    expect(response.status).toBe(401);
  });

  it('answers 200 with the user info for a valid token', async () => {
    const target = app();
    const token = await tokenOf(await register(target));

    const response = await target.request('/api/v1/auth/me', { headers: bearer(token) });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { userId: string; walletId: string };
    };
    expect(body.user.userId).toMatch(/^user_/);
    expect(body.user.walletId).toMatch(/^wallet_/);
  });

  it('never answers with the password hash', async () => {
    const target = app();
    const token = await tokenOf(await register(target));

    const text = await (await target.request('/api/v1/auth/me', { headers: bearer(token) })).text();

    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('scrypt');
  });

  it('answers 401 for a token signed with another secret', async () => {
    const response = await app().request('/api/v1/auth/me', {
      headers: bearer(await tokenOf(await register(app({ jwtSecret: randomJwtSecret() })))),
    });

    expect(response.status).toBe(401);
  });
});

describe('DELETE /auth/logout', () => {
  it('answers 204 and refuses the same token afterwards', async () => {
    const target = app();
    const token = await tokenOf(await register(target));

    const logout = await target.request('/api/v1/auth/logout', {
      method: 'DELETE',
      headers: bearer(token),
    });

    expect(logout.status).toBe(204);
    const me = await target.request('/api/v1/auth/me', { headers: bearer(token) });
    expect(me.status).toBe(401);
  });

  it('answers 401 without a token', async () => {
    const response = await app().request('/api/v1/auth/logout', { method: 'DELETE' });

    expect(response.status).toBe(401);
  });

  it('leaves other tokens working', async () => {
    const target = app();
    const first = await tokenOf(await register(target));
    await target.request('/api/v1/auth/logout', {
      method: 'DELETE',
      headers: bearer(first),
    });

    // A second user on the same app is unaffected by the first logout.
    const second = await tokenOf(await register(target, PASSWORD, 'bob'));
    const me = await target.request('/api/v1/auth/me', { headers: bearer(second) });

    expect(me.status).toBe(200);
  });

  it('does not refuse a token from another app', async () => {
    // Each app has its own logout list unless one is handed in.
    const one = app();
    const two = app();
    const token = await tokenOf(await register(one));

    await one.request('/api/v1/auth/logout', { method: 'DELETE', headers: bearer(token) });
    const me = await two.request('/api/v1/auth/me', { headers: bearer(token) });

    expect(me.status).toBe(200);
  });

  it('refuses a logged-out token in every app that shares the logout list', async () => {
    const store = userStore();
    const revoked = new TokenRevocation();
    const one = app({ userStore: store, jwtSecret: SECRET, revoked });
    const token = await tokenOf(await register(one));

    await one.request('/api/v1/auth/logout', { method: 'DELETE', headers: bearer(token) });
    expect(revoked.size).toBe(1);

    const two = app({ userStore: store, jwtSecret: SECRET, revoked });
    const me = await two.request('/api/v1/auth/me', { headers: bearer(token) });

    expect(me.status).toBe(401);
    expect(revoked.size).toBe(1);
  });
});

describe('auth endpoints and the rest of the app', () => {
  it('keeps the wallet endpoints public', async () => {
    const response = await app().request('/api/v1/health');

    expect(response.status).toBe(200);
  });

  it('answers 404 for an unknown auth path', async () => {
    const response = await app().request('/api/v1/auth/nothing');

    expect(response.status).toBe(404);
  });

  it('answers 404 for an unknown method on an auth path', async () => {
    const response = await app().request('/api/v1/auth/register', { method: 'DELETE' });

    expect(response.status).toBe(404);
  });

  it('is rate limited like the rest of /api/v1', async () => {
    const target = app({ rateLimiter: new RateLimiter({ limit: 1, windowMs: 60_000 }) });
    await register(target);

    const again = await register(target);

    expect(again.status).toBe(429);
  });
});

describe('ApiError', () => {
  it('carries the status and code it was built with', () => {
    const error = new ApiError(409, 'USERNAME_TAKEN', 'taken');

    expect(error.status).toBe(409);
    expect(error.code).toBe('USERNAME_TAKEN');
    expect(error.name).toBe('ApiError');
  });
});
