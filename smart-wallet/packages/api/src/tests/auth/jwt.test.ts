import { describe, expect, it } from 'vitest';
import {
  randomJwtSecret,
  signToken,
  TokenError,
  TokenRevocation,
  verifyToken,
} from '../../auth/jwt';

const SECRET = randomJwtSecret();

/** A minimal, valid payload. */
function payload(): { userId: string; walletId: string; jti: string } {
  return { userId: 'user_1', walletId: 'wallet_1', jti: 'jti_1' };
}

/** Waits `ms`, so an expiry actually passes. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('signToken / verifyToken', () => {
  it('round-trips the payload untouched', async () => {
    const claims = payload();
    const token = await signToken(claims, SECRET);
    const verified = await verifyToken(token, SECRET);

    expect(verified.userId).toBe(claims.userId);
    expect(verified.walletId).toBe(claims.walletId);
    expect(verified.jti).toBe(claims.jti);
  });

  it('produces three base64url segments', async () => {
    const token = await signToken(payload(), SECRET);

    expect(token.split('.')).toHaveLength(3);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('stamps an expiry eight hours out by default', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signToken(payload(), SECRET);
    const verified = await verifyToken(token, SECRET);
    const after = Math.floor(Date.now() / 1000);

    expect(verified.iat).toBeGreaterThanOrEqual(before);
    expect(verified.iat).toBeLessThanOrEqual(after);
    expect(verified.exp).toBe((verified.iat ?? 0) + 8 * 60 * 60);
  });

  it('honours a caller-chosen lifetime', async () => {
    const token = await signToken(payload(), SECRET, '15m');
    const verified = await verifyToken(token, SECRET);

    expect(verified.exp).toBe((verified.iat ?? 0) + 15 * 60);
  });

  it('produces a different token for a different payload', async () => {
    const one = await signToken(payload(), SECRET);
    const two = await signToken({ ...payload(), userId: 'user_2' }, SECRET);

    expect(one).not.toBe(two);
  });
});

describe('verifyToken failures', () => {
  it('rejects a token signed with another secret', async () => {
    const token = await signToken(payload(), randomJwtSecret());

    await expect(verifyToken(token, SECRET)).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects an expired token', async () => {
    // jose counts expiry in whole seconds, so the shortest life is one second
    // and the wait has to be just over it.
    const token = await signToken(payload(), SECRET, 1);
    await delay(1_100);

    await expect(verifyToken(token, SECRET)).rejects.toMatchObject({ code: 'EXPIRED_TOKEN' });
  });

  it('rejects a tampered token', async () => {
    const token = await signToken(payload(), SECRET);
    const parts = token.split('.');
    // Flip one character of the signature segment.
    const signature = parts[2] ?? '';
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;

    await expect(verifyToken(`${parts[0]}.${parts[1]}.${flipped}`, SECRET)).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('rejects a tampered payload', async () => {
    const token = await signToken(payload(), SECRET);
    const parts = token.split('.');
    const forged = Buffer.from(JSON.stringify({ userId: 'attacker', walletId: 'w' })).toString(
      'base64url',
    );

    await expect(verifyToken(`${parts[0]}.${forged}.${parts[2]}`, SECRET)).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('rejects an unsigned token ("alg: none")', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ userId: 'attacker' })).toString('base64url');

    await expect(verifyToken(`${header}.${body}.`, SECRET)).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects an empty or non-string token', async () => {
    await expect(verifyToken('', SECRET)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(verifyToken(undefined as never, SECRET)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});

describe('signToken input checks', () => {
  it('rejects an empty secret', async () => {
    await expect(signToken(payload(), new Uint8Array())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('rejects a secret that is not a Uint8Array', async () => {
    await expect(signToken(payload(), 'secret' as never)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});

describe('randomJwtSecret', () => {
  it('returns 32 fresh bytes every call', () => {
    const one = randomJwtSecret();
    const two = randomJwtSecret();

    expect(one).toHaveLength(32);
    expect(two).toHaveLength(32);
    expect(Buffer.from(one).toString('hex')).not.toBe(Buffer.from(two).toString('hex'));
  });

  it('works as a signing secret', async () => {
    const secret = randomJwtSecret();
    const token = await signToken(payload(), secret);

    expect((await verifyToken(token, secret)).userId).toBe('user_1');
  });
});

describe('TokenRevocation', () => {
  it('refuses a revoked token id', async () => {
    const revoked = new TokenRevocation();
    const claims = { ...payload(), exp: Math.floor(Date.now() / 1000) + 600 };
    const token = await signToken(claims, SECRET);
    const verified = await verifyToken(token, SECRET);

    expect(revoked.isRevoked(verified)).toBe(false);
    revoked.revoke(verified);
    expect(revoked.isRevoked(verified)).toBe(true);
    expect(revoked.size).toBe(1);
  });

  it('stops refusing a token whose expiry has passed', () => {
    const revoked = new TokenRevocation();
    const now = Math.floor(Date.now() / 1000);

    revoked.revoke({ userId: 'u', walletId: 'w', jti: 'gone', exp: now - 10 });

    expect(revoked.isRevoked({ userId: 'u', walletId: 'w', jti: 'gone', exp: now - 10 })).toBe(
      false,
    );
    expect(revoked.size).toBe(0);
  });

  it('leaves other tokens alone', () => {
    const revoked = new TokenRevocation();
    const exp = Math.floor(Date.now() / 1000) + 600;
    revoked.revoke({ userId: 'u', walletId: 'w', jti: 'one', exp });

    expect(revoked.isRevoked({ userId: 'u', walletId: 'w', jti: 'two', exp })).toBe(false);
  });

  it('has nothing to revoke without a token id', () => {
    const revoked = new TokenRevocation();

    expect(revoked.revoke({ userId: 'u', walletId: 'w', exp: 1 })).toBe(false);
    expect(revoked.isRevoked({ userId: 'u', walletId: 'w' })).toBe(false);
  });

  it('rejects an empty token id', () => {
    const revoked = new TokenRevocation();

    expect(() => revoked.add('', 1)).toThrow(TokenError);
  });

  it('forgets everything on clear()', () => {
    const revoked = new TokenRevocation();
    const exp = Math.floor(Date.now() / 1000) + 600;
    revoked.revoke({ userId: 'u', walletId: 'w', jti: 'one', exp });

    revoked.clear();

    expect(revoked.size).toBe(0);
  });
});
