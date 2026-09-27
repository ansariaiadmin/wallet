import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
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
import { SmartWallet } from '@wallet/sdk';
import { createLogger, type Logger } from './logger';
import { MetricsRegistry } from './metrics';
import { cacheRoutes } from './routes/cache';
import { TxStore } from './tx-status';
import { healthRoutes } from './routes/health';
import { metricsRoutes } from './routes/metrics';
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
  /**
   * Where the API writes structured logs. Defaults to one JSON line per event
   * on the console; pass {@link nullLogger} to silence a test.
   */
  readonly logger?: Logger;
  /** Counters served at `/metrics`. Defaults to one registry per app. */
  readonly metrics?: MetricsRegistry;
  /**
   * The wallet `/price` and `/risk` read through. Defaults to one built on the
   * app's own cached oracle and checker.
   */
  readonly wallet?: SmartWallet;
}

/**
 * Wires the shared error mapping onto `app` and returns it.
 *
 * Every failure — an {@link ApiError} a route raised, an upstream error from
 * the core, router or chains packages, or anything unexpected — is rendered as
 * the same JSON body, so a caller never sees a stack trace.
 */
export function withErrorHandler(app: Hono, logger: Logger = createLogger()): Hono {
  app.onError((error, c) => {
    const { status, body } = errorResponse(error);
    if (status === 500) {
      // Logged for the operator, never sent to the client. The message is the
      // only field that can carry request data, and the handler is the only
      // place it is written, so nothing secret reaches a log line.
      logger.error('unhandled API error', {
        path: c.req.path,
        method: c.req.method,
        code: (body as { code?: string }).code,
        error: error instanceof Error ? error.message : String(error),
      });
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
  const logger = deps.logger ?? createLogger();
  const metrics = deps.metrics ?? new MetricsRegistry();
  const app = withErrorHandler(new Hono(), logger);

  app.notFound((c) =>
    c.json({ error: `no route for ${c.req.method} ${c.req.path}`, code: 'NOT_FOUND' }, 404),
  );

  // Registered first so every /api/v1 answer is counted and stamped.
  app.use('/api/v1/*', rateLimitMiddleware(deps.rateLimiter ?? new RateLimiter()));

  app.use(observabilityMiddleware(logger, metrics));

  // Still constructed here because `/cache` reports on them, but no route
  // reads a price or a verdict through them any more: `/price` and `/risk` go
  // through `SmartWallet`, which owns the oracle and the checker.
  const price = deps.price ?? createCachedOracle();
  const risk = deps.risk ?? createCachedRisk();
  // One wallet for the whole app, wired to the app's own cached oracle and
  // checker. `/price` and `/risk` read through it, and `/cache` reports on the
  // same two instances — so the numbers an operator sees are the numbers the
  // routes actually used, not a second, unused cache.
  const wallet = deps.wallet ?? new SmartWallet({ oracle: price, riskChecker: risk });

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

  app.route('/api/v1', healthRoutes({ registry: metrics }));
  app.route('/api/v1', priceRoutes(wallet));
  app.route('/api/v1', riskRoutes(wallet));
  app.route('/api/v1', quoteRoutes(createSwapRouter()));
  app.route('/api/v1', txRoutes());
  // One store per app, shared by the route that records a broadcast and the
  // route that reads it back: a broadcast must be findable by its own app and
  // invisible to any other app in the same process.
  const txStore = deps.txStore ?? new TxStore();
  app.route('/api/v1', broadcastRoutes({ store: txStore }));
  app.route('/api/v1', statusRoutes({ store: txStore }));
  app.route('/api/v1', cacheRoutes({ price, risk }));
  app.route('/api/v1', metricsRoutes({ registry: metrics }));

  return app;
}

/**
 * Times every `/api/v1` request, counts it, and logs the ones that failed.
 *
 * The route label is the matched path with parameters left out, so
 * `/tx/ethereum/0xabc/status` counts as `/tx/:network/:hash/status` and the
 * series stays bounded by the number of routes rather than by traffic.
 */
function observabilityMiddleware(logger: Logger, metrics: MetricsRegistry): MiddlewareHandler {
  return async (c, next) => {
    const started = Date.now();
    await next();
    const durationMs = Date.now() - started;
    const route = c.req.routePath || c.req.path;
    const status = c.res.status;
    metrics.record(route, status, durationMs);
    if (status >= 500) {
      logger.error('request failed', { route, status, durationMs });
    } else if (status >= 400) {
      // A 4xx is a caller mistake, worth a warn and not worth waking anyone.
      logger.warn('request rejected', { route, status, durationMs });
    }
  };
}
