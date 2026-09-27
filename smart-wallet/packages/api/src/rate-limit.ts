/**
 * In-memory per-IP rate limiting for the `/api/v1` surface.
 *
 * The window is **fixed**: every client gets a 60 second bucket that restarts
 * when it elapses, so the answer to "how many are left" and "when do I get
 * more" is exact and costs one map lookup. A sliding window would be fairer
 * around the boundary but needs a per-request log; the trade-off is recorded
 * in the phase report.
 *
 * State lives in this process only: there is no shared store, so a restart
 * forgets every bucket and a horizontally scaled deployment counts per
 * instance. That is deliberate for a facade that is otherwise stateless.
 */

import type { Context, MiddlewareHandler } from 'hono';

/** Requests allowed per client per window. */
export const DEFAULT_RATE_LIMIT = 60;
/** Length of a window in ms: 60 requests per minute. */
export const DEFAULT_RATE_WINDOW_MS = 60_000;

/** One client's counter inside its current window. */
interface Bucket {
  count: number;
  /** Epoch ms the current window started. */
  startedAt: number;
}

/** What a caller is told about its standing. */
export interface RateLimitVerdict {
  /** Whether this request may proceed. */
  readonly allowed: boolean;
  /** Requests still available in the current window. */
  readonly remaining: number;
  /** Epoch ms the current window ends. */
  readonly resetAt: number;
  /** Seconds until the window resets; `0` when the request was allowed. */
  readonly retryAfterSeconds: number;
}

/** Knobs for a {@link RateLimiter}. */
export interface RateLimiterOptions {
  /** Requests per window. Default 60. */
  readonly limit?: number;
  /** Window length in ms. Default 60_000. */
  readonly windowMs?: number;
  /** Clock in ms, injected so tests can cross a window boundary. */
  readonly now?: () => number;
}

export class RateLimiter {
  /** Requests allowed per window. */
  readonly limit: number;
  /** Window length in ms. */
  readonly windowMs: number;

  private readonly now: () => number;
  private readonly clients = new Map<string, Bucket>();

  constructor(options: RateLimiterOptions = {}) {
    this.limit = options.limit ?? DEFAULT_RATE_LIMIT;
    this.windowMs = options.windowMs ?? DEFAULT_RATE_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Counts one request from `client` and reports the standing.
   *
   * A rejected request does not consume budget: the bucket is already full.
   */
  check(client: string): RateLimitVerdict {
    const timestamp = this.now();
    const bucket = this.clients.get(client);
    const active =
      bucket !== undefined && timestamp - bucket.startedAt < this.windowMs ? bucket : undefined;
    const startedAt = active?.startedAt ?? timestamp;
    const used = active?.count ?? 0;

    if (used >= this.limit) {
      const resetAt = startedAt + this.windowMs;
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - timestamp) / 1_000)),
      };
    }

    const count = used + 1;
    this.clients.set(client, { count, startedAt });
    return {
      allowed: true,
      remaining: this.limit - count,
      resetAt: startedAt + this.windowMs,
      retryAfterSeconds: 0,
    };
  }

  /** Forgets every bucket, e.g. between tests. */
  reset(): void {
    this.clients.clear();
  }

  /** How many clients currently hold a bucket. */
  get size(): number {
    return this.clients.size;
  }
}

/** Headers every `/api/v1` answer carries. */
export const RATE_LIMIT_HEADERS = {
  limit: 'X-RateLimit-Limit',
  remaining: 'X-RateLimit-Remaining',
  reset: 'X-RateLimit-Reset',
} as const;

/**
 * Middleware that rate limits by client and stamps the standing onto every
 * response, allowed or not.
 */
export function rateLimitMiddleware(limiter: RateLimiter): MiddlewareHandler {
  return async (c, next) => {
    const verdict = limiter.check(clientKey(c));

    c.header(RATE_LIMIT_HEADERS.limit, String(limiter.limit));
    c.header(RATE_LIMIT_HEADERS.remaining, String(verdict.remaining));
    c.header(RATE_LIMIT_HEADERS.reset, String(Math.floor(verdict.resetAt / 1_000)));

    if (!verdict.allowed) {
      c.header('Retry-After', String(verdict.retryAfterSeconds));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: `rate limit exceeded: ${limiter.limit} requests per minute`,
          },
          retryAfter: verdict.retryAfterSeconds,
        },
        429,
      );
    }

    await next();
  };
}

/**
 * Best-effort client identity: the proxy header when one is present, then the
 * direct address, then a single shared bucket. Tests can pin a client by
 * sending `x-forwarded-for`.
 */
export function clientKey(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    return forwarded.split(',')[0]?.trim() ?? 'anonymous';
  }
  const real = c.req.header('x-real-ip');
  if (typeof real === 'string' && real.trim() !== '') {
    return real.trim();
  }
  return 'anonymous';
}
