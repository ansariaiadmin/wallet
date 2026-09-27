import { Hono } from 'hono';
import {
  CachedOracle,
  CachedRiskAssessor,
  mockBinanceProvider,
  mockChainalysisProvider,
  mockCoinGeckoProvider,
  mockKrakenProvider,
  mockOfacProvider,
  mockTokenWatchProvider,
  PriceOracle,
  RiskChecker,
} from '@wallet/core';
import { mockEvmAdapter, mockSolanaAdapter, mockTronAdapter, SwapRouter } from '@wallet/router';
import { errorResponse } from './errors';
import { randomJwtSecret, TokenRevocation } from './auth/jwt';
import { authRoutes } from './auth/router';
import { MemoryUserStore, type UserStore } from './auth/user-store';
import type { KeyStore } from '@wallet/keys';
import { rateLimitMiddleware, RateLimiter } from './rate-limit';
import { cacheRoutes } from './routes/cache';
import { TxStore } from './tx-status';
import { healthRoutes } from './routes/health';
import { priceRoutes } from './routes/price';
import { quoteRoutes } from './routes/quote';
import { riskRoutes } from './routes/risk';
import { broadcastRoutes, statusRoutes } from './routes/broadcast';
import { txRoutes } from './routes/tx';

/**
/** The deterministic mock providers every route is wired with. */
function createOracle(): PriceOracle {
  return new PriceOracle([mockCoinGeckoProvider, mockBinanceProvider, mockKrakenProvider]);
}

function createRiskChecker(): RiskChecker {
  return new RiskChecker([mockOfacProvider, mockChainalysisProvider, mockTokenWatchProvider]);
}

/** The oracle with the P12 price cache in front of it. */
function createCachedOracle(): CachedOracle {
  return new CachedOracle(createOracle());
}

/** The checker with the P12 screening cache in front of it. */
function createCachedRisk(): CachedRiskAssessor {
  return new CachedRiskAssessor(createRiskChecker());
}

function createSwapRouter(): SwapRouter {
  return new SwapRouter([mockEvmAdapter, mockSolanaAdapter, mockTronAdapter]);
}

/** Dependencies a test (or an embedder) can replace in {@link createApp}. */
export interface AppDeps {
  /** Cached price feed; defaults to the mock providers behind the P12 cache. */
  readonly price?: CachedOracle;
  /** Cached screening feed; defaults to the mock providers behind the P12 cache. */
  readonly risk?: CachedRiskAssessor;
  /** Rate limiter for `/api/v1`; defaults to 60 requests per minute per client. */
  readonly rateLimiter?: RateLimiter;
  /** User directory for `/auth`; defaults to a fresh in-memory store. */
  readonly userStore?: UserStore;
  /** Encrypted mnemonic store registering writes to; none by default. */
  readonly keystore?: KeyStore;
  /**
   * Logout list the `/auth` endpoints share. Defaults to one per app; pass the
   * same instance to several apps when they must agree on what is logged out.
   */
  readonly revoked?: TokenRevocation;
  /**
   * Secret the `/auth` tokens are signed with. Defaults to a random secret for
   * the life of the process, which is right for dev and tests: every restart
   * invalidates every token, and nothing secret has to be configured.
   */
  readonly jwtSecret?: Uint8Array;
  /**
   * Where broadcasts are remembered. Defaults to one per app; pass the same
   * instance to several apps when they must agree on what was broadcast.
   */
  readonly txStore?: TxStore;
}

/**
 * Wires the shared error mapping onto `app` and returns it.
 *
 * Every failure — an {@link ApiError} a route raised, an upstream error from
 * the core, router or chains packages, or anything unexpected — is rendered as
 * the same JSON body, so a caller never sees a stack trace.
 */
export function withErrorHandler(app: Hono): Hono {
  app.onError((error, c) => {
    const { status, body } = errorResponse(error);
    if (status === 500) {
      // Logged for the operator, never sent to the client.
      console.error('unhandled API error:', error);
    }
    return c.json(body, status);
  });
  return app;
}

/**
 * Builds the REST application.
 *
 * Every route lives under `/api/v1` and every dependency is constructed here,
 * so the factory returns a fresh, fully wired app with no module level state
 * and no listening socket: the caller decides how to serve it (`serve()` from
 * `@hono/node-server`, a worker, or `app.request()` in tests).
 */
export function createApp(deps: AppDeps = {}): Hono {
  const app = withErrorHandler(new Hono());

  app.notFound((c) =>
    c.json({ error: `no route for ${c.req.method} ${c.req.path}`, code: 'NOT_FOUND' }, 404),
  );

  // Registered first so every /api/v1 answer is counted and stamped.
  app.use('/api/v1/*', rateLimitMiddleware(deps.rateLimiter ?? new RateLimiter()));

  const price = deps.price ?? createCachedOracle();
  const risk = deps.risk ?? createCachedRisk();

  // One logout list per app by default, shared by the routes that mint tokens
  // and the middleware that refuses them.
  const revoked = deps.revoked ?? new TokenRevocation();
  app.route(
    '/api/v1',
    authRoutes({
      userStore: deps.userStore ?? new MemoryUserStore(),
      secret: deps.jwtSecret ?? randomJwtSecret(),
      keystore: deps.keystore,
      revoked,
    }),
  );

  app.route('/api/v1', healthRoutes());
  app.route('/api/v1', priceRoutes(price));
  app.route('/api/v1', riskRoutes(risk));
  app.route('/api/v1', quoteRoutes(createSwapRouter()));
  app.route('/api/v1', txRoutes());
  // One store per app, shared by the route that records a broadcast and the
  // route that reads it back: a broadcast must be findable by its own app and
  // invisible to any other app in the same process.
  const txStore = deps.txStore ?? new TxStore();
  app.route('/api/v1', broadcastRoutes({ store: txStore }));
  app.route('/api/v1', statusRoutes({ store: txStore }));
  app.route('/api/v1', cacheRoutes({ price, risk }));

  return app;
}
