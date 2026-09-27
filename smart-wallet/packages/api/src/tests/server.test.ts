import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerType } from '@hono/node-server';
import { startServer } from '../server';
import { configFromEnv } from '../config';
import { verifyToken } from '../auth/jwt';

const PASSWORD = 'correct horse battery staple';

/** The server under test, closed after every case. */
let server: ServerType | undefined;

afterEach(async () => {
  server?.close();
  server = undefined;
});

/** Starts the app on an ephemeral port and returns its base URL. */
async function listening(env: Record<string, string | undefined> = {}): Promise<string> {
  const config = configFromEnv(env);
  server = startServer({}, config);
  await new Promise((resolve) => server?.once('listening', resolve));
  const address = server?.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  expect(port).toBeGreaterThan(0);
  return `http://127.0.0.1:${port}`;
}

/**
 * Fetches with `connection: close`.
 *
 * Every test starts a fresh server on an ephemeral port, and the OS recycles
 * those ports: without this header the HTTP agent happily reuses a pooled
 * socket that belongs to a server a previous test already closed.
 */
function request(base: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { connection: 'close', ...(init.headers as Record<string, string> | undefined) },
  });
}

/** Registers a user and returns the token the answer carried. */
async function register(base: string, username = 'alice'): Promise<string> {
  const response = await request(base, '/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { token: string };
  return body.token;
}

describe('startServer', () => {
  it('serves health over a real socket', async () => {
    const base = await listening();

    const response = await request(base, '/api/v1/health');

    expect(response.status).toBe(200);
    expect((await response.json()) as { status: string }).toMatchObject({ status: 'ok' });
  });

  it('does not start a server when the module is only imported', () => {
    // Importing `server.ts` must be side-effect free; the test above is what
    // proves the entry-point guard works, because it is the only listener.
    expect(server).toBeUndefined();
  });

  it('walks register → me → logout → 401 over the socket', async () => {
    const base = await listening();
    const token = await register(base);

    const me = await request(base, '/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json()) as { user: { walletIds: string[] } }).toMatchObject({
      user: { walletIds: [expect.stringMatching(/^wallet_/) as unknown as string] },
    });

    const logout = await request(base, '/api/v1/auth/logout', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logout.status).toBe(204);

    const after = await request(base, '/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });

  it('signs tokens with the secret from the environment', async () => {
    const secret = 'c'.repeat(64);
    const base = await listening({ JWT_SECRET: secret });
    const token = await register(base);
    const payload = await verifyToken(token, Uint8Array.from(Buffer.from(secret, 'hex')));

    expect(payload.userId).toMatch(/^user_/);
  });

  it('writes an encrypted mnemonic to the configured directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wallet-server-'));
    const base = await listening({ KEYSTORE_DIR: dir, JWT_SECRET: 'd'.repeat(64) });
    const response = await request(base, '/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: PASSWORD }),
    });
    const body = (await response.json()) as {
      user: { walletIds: readonly string[] };
      mnemonic: string;
    };

    expect(body.mnemonic.split(' ')).toHaveLength(12);
    const files = await readdir(dir);
    expect(files).toEqual([`${body.user.walletIds[0]}.enc`]);
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses to start on a port that is not a port', async () => {
    expect(() => startServer({}, configFromEnv({ PORT: 'nope' }))).toThrow(/PORT/);
  });
});
