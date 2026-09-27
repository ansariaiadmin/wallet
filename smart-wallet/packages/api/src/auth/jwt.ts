/**
 * JWT issuing and verification, on `jose`.
 *
 * HS256 with a shared secret is the right shape here: one process issues and
 * verifies its own tokens, there is no key distribution to get wrong, and
 * `jose` pins the accepted algorithm so a token signed with `alg: none` or with
 * an asymmetric algorithm cannot be smuggled in.
 *
 * The secret is never logged and never leaves this module: callers hand it in
 * as bytes and get back either a token or a thrown {@link TokenError}.
 */

import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/** The only algorithm this module signs with and accepts. */
export const ALGORITHM = 'HS256';

/** How long a token lives unless the caller says otherwise. */
export const DEFAULT_EXPIRES_IN = '8h';

/** What a token carries. Everything in it is readable by its holder. */
export interface TokenPayload extends JWTPayload {
  /** User the token belongs to. */
  readonly userId: string;
  /** Wallet the user owns; the signing phase needs it. */
  /** Every wallet the user owns; a user can own more than one. */
  readonly walletIds: readonly string[];
  /** Unique token id, the key {@link TokenRevocation} revokes by. */
  readonly jti?: string;
}

/** Raised when a token cannot be issued or verified. */
export class TokenError extends Error {
  constructor(
    readonly code: 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'INVALID_INPUT',
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

/**
 * Signs `payload` into a compact JWT.
 *
 * `expiresIn` is anything `jose` understands — `'8h'`, `'15m'`, `3600` (seconds).
 */
export async function signToken(
  payload: TokenPayload,
  secret: Uint8Array,
  expiresIn: string | number = DEFAULT_EXPIRES_IN,
): Promise<string> {
  requireSecret(secret);
  const builder = new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(expiresIn);
  return builder.sign(secret);
}

/** Verifies `token` and returns its payload, or throws a {@link TokenError}. */
export async function verifyToken(token: string, secret: Uint8Array): Promise<TokenPayload> {
  requireSecret(secret);
  if (typeof token !== 'string' || token === '') {
    throw new TokenError('INVALID_INPUT', 'a token is a non-empty string');
  }
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALGORITHM] });
    return payload as TokenPayload;
  } catch (error) {
    const expired =
      error instanceof Error && (error as { code?: string }).code === 'ERR_JWT_EXPIRED';
    throw new TokenError(
      expired ? 'EXPIRED_TOKEN' : 'INVALID_TOKEN',
      expired ? 'the token has expired' : 'the token is not valid',
      error,
    );
  }
}

/**
 * A fresh random secret, for a process that has none configured.
 *
 * 32 bytes from the runtime CSPRNG. Because it is random per process, every
 * restart invalidates every token — the safe default when no secret was handed
 * in, and the reason it never needs to be logged.
 */
export function randomJwtSecret(): Uint8Array {
  return randomBytes(32);
}

/** Rejects a secret that cannot key HS256. */
function requireSecret(secret: Uint8Array): void {
  if (!(secret instanceof Uint8Array) || secret.length === 0) {
    throw new TokenError('INVALID_INPUT', 'the signing secret must be a non-empty Uint8Array');
  }
}

/**
 * In-memory logout list.
 *
 * A JWT is valid until it expires, so "log out" has to mean "remember that this
 * token must be refused from now on". Entries are keyed by the token id and
 * carry the expiry, so a revoked token is only remembered as long as it could
 * still have been used — the set cannot grow without bound.
 */
export class TokenRevocation {
  private readonly revoked = new Map<string, number>();

  /** Refuses `jti` until `expiresAtMs` (epoch milliseconds). */
  add(jti: string, expiresAtMs: number): void {
    if (typeof jti !== 'string' || jti === '') {
      throw new TokenError('INVALID_INPUT', 'a token id is a non-empty string');
    }
    this.revoked.set(jti, expiresAtMs);
  }

  /** Revokes the token a payload belongs to, when it carries an id and expiry. */
  revoke(payload: TokenPayload, now = Date.now()): boolean {
    const jti = payload.jti;
    const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : now;
    if (jti === undefined) {
      return false;
    }
    this.add(jti, expiresAt);
    return true;
  }

  /** Whether the token id is refused. Expired entries are dropped on the way. */
  isRevoked(payload: TokenPayload, now = Date.now()): boolean {
    const jti = payload.jti;
    if (jti === undefined) {
      return false;
    }
    const expiresAt = this.revoked.get(jti);
    if (expiresAt === undefined) {
      return false;
    }
    if (expiresAt <= now) {
      // The token is expired anyway, so the entry has done its job.
      this.revoked.delete(jti);
      return false;
    }
    return true;
  }

  /** How many tokens are currently refused. */
  get size(): number {
    this.sweep();
    return this.revoked.size;
  }

  /** Forgets every revoked token. */
  clear(): void {
    this.revoked.clear();
  }

  /** Drops entries whose token has expired. */
  private sweep(): void {
    const now = Date.now();
    for (const [jti, expiresAt] of this.revoked) {
      if (expiresAt <= now) {
        this.revoked.delete(jti);
      }
    }
  }
}
