/**
 * Authentication middleware.
 *
 * `requireAuth` reads the `Authorization: Bearer <token>` header, verifies the
 * token and puts its payload on the context for the route to read. A missing,
 * malformed, expired or logged-out token is a 401; nothing about *why* leaks
 * beyond that, and the token itself is never logged.
 */

import { HTTPException } from 'hono/http-exception';
import type { MiddlewareHandler } from 'hono';
import { verifyToken, type TokenPayload, type TokenRevocation } from './jwt';

/** The context variable the middleware sets. */
export interface AuthVariables {
  readonly user: TokenPayload;
}

/** A route that can read {@link AuthVariables}. */
export type AuthEnv = { Variables: AuthVariables };

/**
 * Builds the middleware that refuses unauthenticated requests.
 *
 * @param secret the same secret the tokens were signed with.
 * @param revoked optional logout list; when given, a logged-out token is a 401.
 */
export function requireAuth(
  secret: Uint8Array,
  revoked?: TokenRevocation,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const header = c.req.header('Authorization');
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new HTTPException(401, { message: 'Missing token' });
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = await verifyToken(token, secret);
      if (revoked !== undefined && revoked.isRevoked(payload)) {
        throw new HTTPException(401, { message: 'Token revoked' });
      }
      c.set('user', payload);
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(401, { message: 'Invalid or expired token' });
    }
    await next();
  };
}

/** Reads the authenticated payload off a context. */
export function authUser(c: { get: (key: 'user') => TokenPayload }): TokenPayload {
  return c.get('user');
}
