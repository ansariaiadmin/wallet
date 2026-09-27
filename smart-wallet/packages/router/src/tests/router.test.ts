import { describe, expect, it } from 'vitest';
import {
  mockEvmAdapter,
  mockSolanaAdapter,
  mockTronAdapter,
  NATIVE_EVM,
  NATIVE_SOL,
  NATIVE_TRON,
  RouterError,
  SwapRouter,
  type AggregatorAdapter,
  type SwapFamily,
  type SwapQuote,
  type SwapRequest,
} from '../index';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const SENDER = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';

/** A valid EVM request; every test overrides only the field it exercises. */
function evmRequest(overrides: Partial<SwapRequest> = {}): SwapRequest {
  return {
    family: 'evm',
    chainId: 1,
    fromToken: NATIVE_EVM,
    toToken: USDC,
    amountIn: 1_000_000_000_000_000_000n,
    slippageBps: 50,
    fromAddress: SENDER,
    ...overrides,
  };
}

function solanaRequest(overrides: Partial<SwapRequest> = {}): SwapRequest {
  return {
    family: 'solana',
    fromToken: NATIVE_SOL,
    toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amountIn: 2_000_000_000n,
    slippageBps: 50,
    fromAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    ...overrides,
  };
}

function tronRequest(overrides: Partial<SwapRequest> = {}): SwapRequest {
  return {
    family: 'tron',
    fromToken: NATIVE_TRON,
    toToken: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    amountIn: 50_000_000n,
    slippageBps: 100,
    fromAddress: 'TRcvCk5fLxxgRc7KopfPXb3GzUqZMjcKkn',
    ...overrides,
  };
}

/** A quote that only differs from the mock one in `aggregator` and `amountOut`. */
function quoteOf(aggregator: string, req: SwapRequest, amountOut: bigint): SwapQuote {
  return {
    aggregator,
    fromToken: req.fromToken,
    toToken: req.toToken,
    amountIn: req.amountIn,
    amountOut,
    feeBps: 30,
    priceImpactBps: 50,
    unsignedTx: { mock: true, adapter: aggregator },
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    meta: {},
  };
}

/** An adapter that answers with `quote`, whatever the request is. */
function stubAdapter(
  name: string,
  family: SwapFamily,
  quote: (req: SwapRequest) => SwapQuote | Promise<SwapQuote>,
): AggregatorAdapter {
  return {
    name,
    supportedFamilies: [family],
    supports: (req) => req.family === family,
    quote: async (req) => quote(req),
  };
}

/** An adapter that always fails, like an aggregator with an outage would. */
function failingAdapter(name: string, family: SwapFamily, message: string): AggregatorAdapter {
  return {
    name,
    supportedFamilies: [family],
    supports: (req) => req.family === family,
    quote: async () => {
      throw new Error(message);
    },
  };
}

describe('mock adapters', () => {
  it('the EVM adapter supports only the evm family', () => {
    expect(mockEvmAdapter.name).toBe('mock-1inch');
    expect(mockEvmAdapter.supportedFamilies).toEqual(['evm']);
    expect(mockEvmAdapter.supports(evmRequest())).toBe(true);
    expect(mockEvmAdapter.supports(solanaRequest())).toBe(false);
    expect(mockEvmAdapter.supports(tronRequest())).toBe(false);
  });

  it('the Solana adapter supports only the solana family', () => {
    expect(mockSolanaAdapter.name).toBe('mock-jupiter');
    expect(mockSolanaAdapter.supportedFamilies).toEqual(['solana']);
    expect(mockSolanaAdapter.supports(evmRequest())).toBe(false);
    expect(mockSolanaAdapter.supports(solanaRequest())).toBe(true);
    expect(mockSolanaAdapter.supports(tronRequest())).toBe(false);
  });

  it('the TRON adapter supports only the tron family', () => {
    expect(mockTronAdapter.name).toBe('mock-sunswap');
    expect(mockTronAdapter.supportedFamilies).toEqual(['tron']);
    expect(mockTronAdapter.supports(evmRequest())).toBe(false);
    expect(mockTronAdapter.supports(solanaRequest())).toBe(false);
    expect(mockTronAdapter.supports(tronRequest())).toBe(true);
  });

  it('returns a quote with every documented field', async () => {
    const quote = await mockEvmAdapter.quote(evmRequest());

    expect(quote.aggregator).toBe('mock-1inch');
    expect(quote.fromToken).toBe(NATIVE_EVM);
    expect(quote.toToken).toBe(USDC);
    expect(quote.amountIn).toBe(1_000_000_000_000_000_000n);
    expect(quote.feeBps).toBe(30);
    expect(quote.priceImpactBps).toBe(50);
    expect(quote.meta).toEqual({});
    expect(Number.isInteger(quote.expiresAt)).toBe(true);
    expect(quote.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 55);
    expect(quote.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60);
  });

  it('simulates 3% slippage on EVM', async () => {
    const req = evmRequest({ amountIn: 1_234_567_890n });
    const quote = await mockEvmAdapter.quote(req);

    expect(quote.amountOut).toBe((req.amountIn * 97n) / 100n);
    expect(quote.amountOut).toBeLessThan(req.amountIn);
  });

  it('simulates 3% slippage on Solana', async () => {
    const req = solanaRequest({ amountIn: 987_654_321n });
    const quote = await mockSolanaAdapter.quote(req);

    expect(quote.amountOut).toBe((req.amountIn * 97n) / 100n);
  });

  it('simulates 3% slippage on TRON', async () => {
    const req = tronRequest({ amountIn: 12_345_678n });
    const quote = await mockTronAdapter.quote(req);

    expect(quote.amountOut).toBe((req.amountIn * 97n) / 100n);
  });

  it('carries a pass-through unsignedTx built from the request', async () => {
    const req = evmRequest();
    const quote = await mockEvmAdapter.quote(req);

    expect(quote.unsignedTx).toEqual({
      mock: true,
      adapter: 'mock-1inch',
      family: 'evm',
      chainId: 1,
      fromToken: NATIVE_EVM,
      toToken: USDC,
      amountIn: req.amountIn,
      amountOut: quote.amountOut,
      slippageBps: 50,
      fromAddress: SENDER,
    });
  });

  it('omits the EVM chainId for families that do not use one', async () => {
    const quote = await mockSolanaAdapter.quote(solanaRequest());
    const payload = quote.unsignedTx as Record<string, unknown>;

    expect(payload.chainId).toBeNull();
  });

  it('is deterministic and does not mutate the request', async () => {
    const req = evmRequest();
    const first = await mockEvmAdapter.quote(req);
    const second = await mockEvmAdapter.quote(req);

    expect(first.amountOut).toBe(second.amountOut);
    expect(first.unsignedTx).toEqual(second.unsignedTx);
    expect(req).toEqual(evmRequest());
  });
});

describe('SwapRouter.bestQuote', () => {
  it('returns the quote with the highest amountOut', async () => {
    const req = evmRequest();
    const low = stubAdapter('low', 'evm', (r) => quoteOf('low', r, 100n));
    const high = stubAdapter('high', 'evm', (r) => quoteOf('high', r, 900n));
    const middle = stubAdapter('middle', 'evm', (r) => quoteOf('middle', r, 500n));
    const router = new SwapRouter([low, high, middle]);

    const best = await router.bestQuote(req);

    expect(best.aggregator).toBe('high');
    expect(best.amountOut).toBe(900n);
  });

  it('returns the only quote when a single adapter supports the request', async () => {
    const router = new SwapRouter([mockEvmAdapter, mockSolanaAdapter, mockTronAdapter]);

    const best = await router.bestQuote(evmRequest());

    expect(best.aggregator).toBe('mock-1inch');
    expect(best.amountOut).toBe((1_000_000_000_000_000_000n * 97n) / 100n);
  });

  it('ignores adapters registered for another family', async () => {
    let calls = 0;
    const solanaOnly = stubAdapter('solana-only', 'solana', (req) => {
      calls += 1;
      return quoteOf('solana-only', req, 1n);
    });
    const router = new SwapRouter([solanaOnly, mockEvmAdapter]);

    const best = await router.bestQuote(evmRequest());

    expect(best.aggregator).toBe('mock-1inch');
    expect(calls).toBe(0);
  });

  it('throws NO_ROUTE when no adapter supports the request', async () => {
    const router = new SwapRouter([mockEvmAdapter, mockTronAdapter]);
    const error = await router.bestQuote(solanaRequest()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RouterError);
    expect((error as RouterError).code).toBe('NO_ROUTE');
    expect((error as RouterError).message).toContain('solana');
  });

  it('throws AGGREGATOR_ERROR when every supporting adapter fails', async () => {
    const router = new SwapRouter([
      failingAdapter('one', 'evm', 'rate limited'),
      failingAdapter('two', 'evm', 'upstream 500'),
      mockSolanaAdapter,
    ]);

    const error = await router.bestQuote(evmRequest()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RouterError);
    expect((error as RouterError).code).toBe('AGGREGATOR_ERROR');
    expect((error as RouterError).message).toContain('2');
    const cause = (error as RouterError).cause as { adapter: string; error: Error }[];
    expect(cause.map((entry) => entry.adapter)).toEqual(['one', 'two']);
    expect(cause[0]?.error.message).toBe('rate limited');
  });

  it('throws AGGREGATOR_ERROR when the only supporting adapter fails', async () => {
    const router = new SwapRouter([failingAdapter('only', 'solana', 'boom'), mockEvmAdapter]);

    const error = await router.bestQuote(solanaRequest()).catch((caught: unknown) => caught);

    expect((error as RouterError).code).toBe('AGGREGATOR_ERROR');
  });

  it('throws INVALID_INPUT when amountIn is zero', async () => {
    const router = new SwapRouter([mockEvmAdapter]);
    const error = await router.bestQuote(evmRequest({ amountIn: 0n })).catch((c: unknown) => c);

    expect(error).toBeInstanceOf(RouterError);
    expect((error as RouterError).code).toBe('INVALID_INPUT');
    expect((error as RouterError).message).toContain('amountIn');
  });

  it('throws INVALID_INPUT when amountIn is negative', async () => {
    const router = new SwapRouter([mockEvmAdapter]);
    const error = await router.bestQuote(evmRequest({ amountIn: -1n })).catch((c: unknown) => c);

    expect((error as RouterError).code).toBe('INVALID_INPUT');
  });

  it('throws INVALID_INPUT when slippageBps exceeds 10000', async () => {
    const router = new SwapRouter([mockEvmAdapter]);
    const error = await router
      .bestQuote(evmRequest({ slippageBps: 10_001 }))
      .catch((c: unknown) => c);

    expect((error as RouterError).code).toBe('INVALID_INPUT');
    expect((error as RouterError).message).toContain('slippageBps');
  });

  it('accepts the slippageBps boundaries', async () => {
    const router = new SwapRouter([mockEvmAdapter]);

    await expect(router.bestQuote(evmRequest({ slippageBps: 0 }))).resolves.toMatchObject({
      aggregator: 'mock-1inch',
    });
    await expect(router.bestQuote(evmRequest({ slippageBps: 10_000 }))).resolves.toMatchObject({
      aggregator: 'mock-1inch',
    });
  });

  it('throws INVALID_INPUT when slippageBps is negative', async () => {
    const router = new SwapRouter([mockEvmAdapter]);
    const error = await router.bestQuote(evmRequest({ slippageBps: -1 })).catch((c: unknown) => c);

    expect((error as RouterError).code).toBe('INVALID_INPUT');
  });

  it('throws INVALID_INPUT when fromToken equals toToken', async () => {
    const router = new SwapRouter([mockEvmAdapter]);
    const error = await router
      .bestQuote(evmRequest({ fromToken: USDC, toToken: USDC }))
      .catch((c: unknown) => c);

    expect((error as RouterError).code).toBe('INVALID_INPUT');
    expect((error as RouterError).message).toContain('fromToken');
  });

  it('throws UNSUPPORTED_FAMILY for an unknown family', async () => {
    const router = new SwapRouter([mockEvmAdapter, mockSolanaAdapter, mockTronAdapter]);
    const error = await router
      .bestQuote(evmRequest({ family: 'bitcoin' as SwapFamily }))
      .catch((c: unknown) => c);

    expect(error).toBeInstanceOf(RouterError);
    expect((error as RouterError).code).toBe('UNSUPPORTED_FAMILY');
    expect((error as RouterError).message).toContain('bitcoin');
  });

  it('keeps the first adapter when two quotes tie', async () => {
    const router = new SwapRouter([
      stubAdapter('first', 'evm', (req) => quoteOf('first', req, 700n)),
      stubAdapter('second', 'evm', (req) => quoteOf('second', req, 700n)),
    ]);

    expect((await router.bestQuote(evmRequest())).aggregator).toBe('first');
  });

  it('keeps no state between calls', async () => {
    const router = new SwapRouter([mockEvmAdapter]);
    const req = evmRequest();

    const first = await router.bestQuote(req);
    await router.bestQuote(evmRequest({ amountIn: 5n })).catch(() => undefined);
    const again = await router.bestQuote(req);

    expect(again).toEqual(first);
  });
});

describe('SwapRouter.allQuotes', () => {
  it('returns every quote, sorted best-first', async () => {
    const router = new SwapRouter([
      stubAdapter('low', 'evm', (req) => quoteOf('low', req, 100n)),
      stubAdapter('high', 'evm', (req) => quoteOf('high', req, 900n)),
      stubAdapter('middle', 'evm', (req) => quoteOf('middle', req, 500n)),
    ]);

    const quotes = await router.allQuotes(evmRequest());

    expect(quotes.map((quote) => quote.aggregator)).toEqual(['high', 'middle', 'low']);
    expect(quotes.map((quote) => quote.amountOut)).toEqual([900n, 500n, 100n]);
  });

  it('skips a failed adapter and returns the rest', async () => {
    const router = new SwapRouter([
      failingAdapter('broken', 'evm', 'aggregator unreachable'),
      mockEvmAdapter,
      stubAdapter('better', 'evm', (req) => quoteOf('better', req, 10n ** 21n)),
    ]);

    const quotes = await router.allQuotes(evmRequest());

    expect(quotes).toHaveLength(2);
    expect(quotes.map((quote) => quote.aggregator)).toEqual(['better', 'mock-1inch']);
  });

  it('returns an empty array when no adapter matches', async () => {
    const router = new SwapRouter([mockEvmAdapter, mockTronAdapter]);

    await expect(router.allQuotes(solanaRequest())).resolves.toEqual([]);
  });

  it('still rejects a malformed request', async () => {
    const router = new SwapRouter([mockEvmAdapter]);
    const error = await router.allQuotes(evmRequest({ amountIn: 0n })).catch((c: unknown) => c);

    expect((error as RouterError).code).toBe('INVALID_INPUT');
  });

  it('returns the mock quote for each family', async () => {
    const router = new SwapRouter([mockEvmAdapter, mockSolanaAdapter, mockTronAdapter]);

    await expect(router.allQuotes(evmRequest())).resolves.toMatchObject([
      { aggregator: 'mock-1inch' },
    ]);
    await expect(router.allQuotes(solanaRequest())).resolves.toMatchObject([
      { aggregator: 'mock-jupiter' },
    ]);
    await expect(router.allQuotes(tronRequest())).resolves.toMatchObject([
      { aggregator: 'mock-sunswap' },
    ]);
  });
});

describe('RouterError and constants', () => {
  it('carries its code and name', () => {
    const error = new RouterError('NO_ROUTE', 'nothing to route', { adapter: 'x' });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RouterError);
    expect(error.code).toBe('NO_ROUTE');
    expect(error.name).toBe('RouterError');
    expect(error.message).toBe('nothing to route');
    expect(error.cause).toEqual({ adapter: 'x' });
  });

  it('accepts every documented code', () => {
    const codes = ['NO_ROUTE', 'AGGREGATOR_ERROR', 'INVALID_INPUT', 'UNSUPPORTED_FAMILY'] as const;

    for (const code of codes) {
      expect(new RouterError(code, code).code).toBe(code);
    }
  });

  it('exposes the native-token sentinels', () => {
    expect(NATIVE_EVM).toBe('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE');
    expect(NATIVE_SOL).toBe('So11111111111111111111111111111111111111112');
    expect(NATIVE_TRON).toBe('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb');
  });
});
