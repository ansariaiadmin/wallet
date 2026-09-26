import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { SwapRouter } from '@wallet/router';
import { createApp } from '../app';
import { quoteRoutes } from '../routes/quote';
import { isChainType, isNonEmptyString, isPositiveNumberString, isTxType } from '../validation';
import { jsonSafe } from '../serialize';

const app = createApp();

/** OFAC-listed Ethereum address from the P8 mock provider. */
const OFAC_EVM = '0x37f53b2d1056e2e07a4aC10AD3B51928cfea0f47';
/** Chainalysis mixer address from the P8 mock provider. */
const MIXER_EVM = '0xc7945533d5A91A739853333d534F4f5801e37730';
const CLEAN_EVM = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const NATIVE_EVM = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const SENDER_SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const RECIPIENT_SOL = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/** POSTs a JSON body and returns the parsed response. */
async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe('GET /api/v1/health', () => {
  it('answers 200 with status ok and a numeric ts', async () => {
    const response = await app.request('/api/v1/health');

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; ts: number };
    expect(body.status).toBe('ok');
    expect(typeof body.ts).toBe('number');
    expect(body.ts).toBeGreaterThan(1_700_000_000);
  });
});

describe('GET /api/v1/price/:symbol', () => {
  it('returns the aggregated price for a known symbol', async () => {
    const response = await app.request('/api/v1/price/ETH');

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      symbol: string;
      price: number;
      change24h: number;
      confidence: string;
      ts: number;
    };
    expect(body.symbol).toBe('ETH');
    expect(body.price).toBe(3200);
    expect(body.change24h).toBe(150);
    expect(body.confidence).toBe('high');
    expect(typeof body.ts).toBe('number');
  });

  it('lower-cases the symbol before looking it up', async () => {
    const response = await app.request('/api/v1/price/sol');

    expect(response.status).toBe(200);
    expect(((await response.json()) as { symbol: string }).symbol).toBe('SOL');
  });

  it('answers 404 with code SYMBOL_NOT_FOUND for an unknown symbol', async () => {
    const response = await app.request('/api/v1/price/DOGE');

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe('SYMBOL_NOT_FOUND');
    expect(typeof body.error).toBe('string');
  });

  it('answers 404 for an empty path parameter', async () => {
    const response = await app.request('/api/v1/price/');

    expect(response.status).toBe(404);
  });
});

describe('POST /api/v1/risk/address', () => {
  it('returns overallRisk none for a clean address', async () => {
    const { status, json } = await post('/api/v1/risk/address', { address: CLEAN_EVM });

    expect(status).toBe(200);
    const body = json as { overallRisk: string; flags: unknown[]; assessedAt: number };
    expect(body.overallRisk).toBe('none');
    expect(body.flags).toEqual([]);
    expect(typeof body.assessedAt).toBe('number');
  });

  it('returns overallRisk critical for an OFAC-listed address', async () => {
    const { status, json } = await post('/api/v1/risk/address', {
      address: OFAC_EVM,
      chain: 'ethereum',
    });

    expect(status).toBe(200);
    const body = json as {
      overallRisk: string;
      flags: { level: string; reason: string; source: string }[];
    };
    expect(body.overallRisk).toBe('critical');
    expect(body.flags).toHaveLength(1);
    expect(body.flags[0]).toMatchObject({
      level: 'critical',
      reason: 'Address on OFAC SDN list',
      source: 'mock-ofac',
    });
  });

  it('returns the medium level for a Chainalysis mixer address', async () => {
    const { status, json } = await post('/api/v1/risk/address', { address: MIXER_EVM });

    expect(status).toBe(200);
    expect((json as { overallRisk: string }).overallRisk).toBe('medium');
  });

  it('answers 400 when the address field is missing', async () => {
    const { status, json } = await post('/api/v1/risk/address', { chain: 'ethereum' });

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('answers 400 when the address is an empty string', async () => {
    const { status, json } = await post('/api/v1/risk/address', { address: '' });

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('answers 400 when the address is only whitespace', async () => {
    const { status } = await post('/api/v1/risk/address', { address: '   ' });

    expect(status).toBe(400);
  });

  it('answers 400 for a body that is not a JSON object', async () => {
    const { status, json } = await post('/api/v1/risk/address', ['not', 'an', 'object']);

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('INVALID_BODY');
  });
});

describe('POST /api/v1/risk/token', () => {
  it('returns overallRisk none for ETH', async () => {
    const { status, json } = await post('/api/v1/risk/token', { symbol: 'ETH' });

    expect(status).toBe(200);
    expect((json as { overallRisk: string }).overallRisk).toBe('none');
    expect((json as { flags: unknown[] }).flags).toEqual([]);
  });

  it('flags USDT with the Chainalysis low warning', async () => {
    const { status, json } = await post('/api/v1/risk/token', { symbol: 'USDT' });

    expect(status).toBe(200);
    const body = json as { overallRisk: string; flags: { source: string; level: string }[] };
    expect(body.overallRisk).toBe('low');
    expect(
      body.flags.some((flag) => flag.source === 'mock-chainalysis' && flag.level === 'low'),
    ).toBe(true);
  });

  it('flags BUSD with the TokenWatch medium warning', async () => {
    const { status, json } = await post('/api/v1/risk/token', { symbol: 'BUSD' });

    expect(status).toBe(200);
    expect((json as { overallRisk: string }).overallRisk).toBe('medium');
  });

  it('matches the symbol case-insensitively', async () => {
    const { status, json } = await post('/api/v1/risk/token', { symbol: 'usdt' });

    expect(status).toBe(200);
    expect((json as { overallRisk: string }).overallRisk).toBe('low');
  });

  it('answers 400 when the symbol field is missing', async () => {
    const { status, json } = await post('/api/v1/risk/token', { chain: 'ethereum' });

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('answers 400 when the symbol is an empty string', async () => {
    const { status } = await post('/api/v1/risk/token', { symbol: '' });

    expect(status).toBe(400);
  });
});

describe('POST /api/v1/quote', () => {
  const validQuote = {
    fromChain: 'ethereum',
    toChain: 'ethereum',
    fromToken: NATIVE_EVM,
    toToken: USDC,
    amount: '1000000000000000000',
  };

  it('returns a best quote plus the full list', async () => {
    const { status, json } = await post('/api/v1/quote', validQuote);

    expect(status).toBe(200);
    const body = json as {
      best: { adapter: string; amountIn: string; amountOut: string; estimatedFee: number } | null;
      all: unknown[];
    };
    expect(body.best).not.toBeNull();
    expect(Array.isArray(body.all)).toBe(true);
    expect(body.all).toHaveLength(1);
    expect(body.best?.adapter).toBe('mock-1inch');
    expect(body.best?.amountIn).toBe('1000000000000000000');
    expect(body.best?.amountOut).toBe('970000000000000000');
    expect(body.best?.estimatedFee).toBe(30);
  });

  it('quotes Solana swaps through the Jupiter mock', async () => {
    const { status, json } = await post('/api/v1/quote', {
      fromChain: 'solana',
      toChain: 'solana',
      fromToken: 'So11111111111111111111111111111111111111112',
      toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '2000000000',
    });

    expect(status).toBe(200);
    expect((json as { best: { adapter: string } }).best?.adapter).toBe('mock-jupiter');
  });

  it('answers 200 with a null best when no adapter covers the chain', async () => {
    // Routed through a router with no adapters at all, which is the only way to
    // reach the null branch with the three mock adapters covering every family.
    const bare = new Hono().route('/api/v1', quoteRoutes(new SwapRouter([])));
    const response = await bare.request('/api/v1/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validQuote),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ best: null, all: [] });
  });

  it('answers 400 when fromToken is missing', async () => {
    const { fromToken: _omitted, ...body } = validQuote;
    const { status, json } = await post('/api/v1/quote', body);

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('INVALID_INPUT');
    expect((json as { error: string }).error).toContain('fromToken');
  });

  it('answers 400 for a non-numeric amount', async () => {
    const { status, json } = await post('/api/v1/quote', { ...validQuote, amount: 'abc' });

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('INVALID_AMOUNT');
  });

  it('answers 400 for a zero amount', async () => {
    const { status } = await post('/api/v1/quote', { ...validQuote, amount: '0' });

    expect(status).toBe(400);
  });

  it('answers 400 for a negative amount', async () => {
    const { status } = await post('/api/v1/quote', { ...validQuote, amount: '-1' });

    expect(status).toBe(400);
  });

  it('answers 400 for a fractional amount', async () => {
    const { status } = await post('/api/v1/quote', { ...validQuote, amount: '1.5' });

    expect(status).toBe(400);
  });

  it('answers 400 for an unsupported fromChain', async () => {
    const { status, json } = await post('/api/v1/quote', { ...validQuote, fromChain: 'dogecoin' });

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('UNSUPPORTED_CHAIN');
  });

  it('answers 400 for a cross-chain quote', async () => {
    const { status, json } = await post('/api/v1/quote', {
      ...validQuote,
      toChain: 'solana',
    });

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('UNSUPPORTED_CHAIN');
  });
});

describe('POST /api/v1/tx/build', () => {
  const evmNative = {
    chain: 'evm',
    type: 'native',
    from: CLEAN_EVM,
    to: '0x00000000219ab540356cBB839Cbe05303d7705Fa',
    amount: '250000000000000000',
  };

  it('builds an unsigned EVM native transfer', async () => {
    const { status, json } = await post('/api/v1/tx/build', evmNative);

    expect(status).toBe(200);
    const body = json as {
      chain: string;
      unsignedTx: { family: string; serialized: string; fee: { maxCost: string } };
    };
    expect(body.chain).toBe('evm');
    expect(body.unsignedTx.family).toBe('evm');
    expect(body.unsignedTx.serialized).toMatch(/^0x02[0-9a-f]+$/);
    expect(typeof body.unsignedTx.fee.maxCost).toBe('string');
  });

  it('builds an unsigned Solana native transfer', async () => {
    const { status, json } = await post('/api/v1/tx/build', {
      chain: 'solana',
      type: 'native',
      from: SENDER_SOL,
      to: RECIPIENT_SOL,
      amount: '1500000000',
    });

    expect(status).toBe(200);
    const body = json as { chain: string; unsignedTx: { family: string; serialized: string } };
    expect(body.chain).toBe('solana');
    expect(body.unsignedTx.family).toBe('solana');
    expect(body.unsignedTx.serialized.length).toBeGreaterThan(0);
  });

  it('builds an unsigned EVM token transfer', async () => {
    const { status, json } = await post('/api/v1/tx/build', {
      ...evmNative,
      type: 'token',
      tokenAddress: USDC,
      decimals: 6,
    });

    expect(status).toBe(200);
    const body = json as { unsignedTx: { meta: { to?: string } } };
    expect(body.unsignedTx.meta.to).toBeDefined();
  });

  it('answers 400 when the to field is missing', async () => {
    const { to: _omitted, ...body } = evmNative;
    const { status, json } = await post('/api/v1/tx/build', body);

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('INVALID_INPUT');
  });

  it('answers 400 for an unknown chain', async () => {
    const { status, json } = await post('/api/v1/tx/build', { ...evmNative, chain: 'bitcoin' });

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('INVALID_CHAIN');
  });

  it('answers 400 for an unknown tx type', async () => {
    const { status, json } = await post('/api/v1/tx/build', { ...evmNative, type: 'swap' });

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('INVALID_TX_TYPE');
  });

  it('answers 400 for a token build without tokenAddress', async () => {
    const { status, json } = await post('/api/v1/tx/build', { ...evmNative, type: 'token' });

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('INVALID_INPUT');
    expect((json as { error: string }).error).toContain('tokenAddress');
  });

  it('answers 400 for a token build without decimals', async () => {
    const { status, json } = await post('/api/v1/tx/build', {
      ...evmNative,
      type: 'token',
      tokenAddress: USDC,
    });

    expect(status).toBe(400);
    expect((json as { code: string }).code).toBe('INVALID_DECIMALS');
  });

  it('answers 400 for a non-positive amount', async () => {
    const { status } = await post('/api/v1/tx/build', { ...evmNative, amount: '0' });

    expect(status).toBe(400);
  });

  it('answers 422 when the builder rejects the input', async () => {
    const { status, json } = await post('/api/v1/tx/build', {
      ...evmNative,
      from: 'not-an-address',
    });

    expect(status).toBe(422);
    expect((json as { code: string }).code).toBe('BUILD_FAILED');
  });

  it('answers 422 for a TRON build because no RPC endpoints are configured', async () => {
    const { status, json } = await post('/api/v1/tx/build', {
      chain: 'tron',
      type: 'native',
      from: 'TRcvCk5fLxxgRc7KopfPXb3GzUqZMjcKkn',
      to: 'TUjQ4teuAzMbboCGcQqhTc1Wot59fEJnBg',
      amount: '25000000',
    });

    expect(status).toBe(422);
    expect((json as { code: string }).code).toBe('BUILD_FAILED');
  });
});

describe('routing and errors', () => {
  it('answers 404 with a JSON body for an unknown route', async () => {
    const response = await app.request('/api/v1/nope');

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe('NOT_FOUND');
    expect(typeof body.error).toBe('string');
  });

  it('answers 404 for an unknown method on a known route', async () => {
    const response = await app.request('/api/v1/quote');

    expect(response.status).toBe(404);
  });

  it('answers 400 for a malformed JSON body', async () => {
    const response = await app.request('/api/v1/risk/address', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('INVALID_JSON');
  });

  it('never leaks a stack trace in an error body', async () => {
    const response = await app.request('/api/v1/price/DOGE');
    const text = await response.text();

    expect(text).not.toContain('at ');
    expect(text).not.toContain('node_modules');
  });

  it('returns a fresh app instance on every createApp() call', () => {
    expect(createApp()).not.toBe(createApp());
  });
});

describe('validation helpers', () => {
  it('isNonEmptyString rejects blanks and non-strings', () => {
    expect(isNonEmptyString('x')).toBe(true);
    expect(isNonEmptyString(' x ')).toBe(true);
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString(42)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
  });

  it('isPositiveNumberString accepts canonical positive integers only', () => {
    expect(isPositiveNumberString('1')).toBe(true);
    expect(isPositiveNumberString('1000000000000000000')).toBe(true);
    expect(isPositiveNumberString('0')).toBe(false);
    expect(isPositiveNumberString('-1')).toBe(false);
    expect(isPositiveNumberString('1.5')).toBe(false);
    expect(isPositiveNumberString('abc')).toBe(false);
    expect(isPositiveNumberString('')).toBe(false);
    expect(isPositiveNumberString(10)).toBe(false);
  });

  it('isChainType and isTxType narrow the unions', () => {
    expect(isChainType('evm')).toBe(true);
    expect(isChainType('solana')).toBe(true);
    expect(isChainType('tron')).toBe(true);
    expect(isChainType('bitcoin')).toBe(false);
    expect(isTxType('native')).toBe(true);
    expect(isTxType('token')).toBe(true);
    expect(isTxType('swap')).toBe(false);
  });
});

describe('jsonSafe', () => {
  it('converts bigint and Uint8Array for JSON transport', () => {
    expect(jsonSafe({ amount: 10n ** 18n })).toEqual({ amount: '1000000000000000000' });
    expect(jsonSafe(new Uint8Array([1, 255]))).toBe('0x01ff');
    expect(jsonSafe({ nested: [{ value: 7n }] })).toEqual({ nested: [{ value: '7' }] });
    expect(jsonSafe('plain')).toBe('plain');
    expect(jsonSafe(null)).toBeNull();
  });

  it('produces a body JSON.stringify can handle', () => {
    const payload = jsonSafe({ fee: { maxCost: 26_500n }, serialized: new Uint8Array([2, 3]) });

    expect(() => JSON.stringify(payload)).not.toThrow();
    expect(JSON.parse(JSON.stringify(payload))).toEqual({
      fee: { maxCost: '26500' },
      serialized: '0x0203',
    });
  });
});
