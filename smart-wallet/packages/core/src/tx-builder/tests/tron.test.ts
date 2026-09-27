import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChainConnector, FeeEstimate } from '@chains';
import { buildTronTx, buildTx } from '../index';
import { BuilderError } from '../types';

const FROM = 'TRcvCk5fLxxgRc7KopfPXb3GzUqZMjcKkn';
const TO = 'TUjQ4teuAzMbboCGcQqhTc1Wot59fEJnBg';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TX_ID = 'd1c9a4b3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5';
const RAW_DATA_HEX = '0a021f2d2208' + 'ab'.repeat(20) + '40c8a5a9a5a5';

interface RecordedCall {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

/** Replaces global fetch with a canned responder and records every call. */
function stubFetch(
  respond: (url: string, body: Record<string, unknown>) => { status?: number; body: unknown },
): RecordedCall[] {
  const calls: RecordedCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ url, body });

      const response = respond(url, body);
      return new Response(JSON.stringify(response.body), {
        status: response.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );

  return calls;
}

function fakeConnector(overrides: Partial<FeeEstimate> = {}): ChainConnector {
  const fee: FeeEstimate = {
    chainId: 'tron',
    network: 'testnet',
    nativeSymbol: 'TRX',
    nativeDecimals: 6,
    units: 265n,
    unitPrice: 0n,
    maxCost: 100_000n,
    formattedMaxCost: '0.1',
    ...overrides,
  };

  return {
    chainId: 'tron',
    network: 'testnet',
    getNativeBalance: async () => {
      throw new Error('not used by the builder');
    },
    getTokenBalances: async () => [],
    estimateFee: async () => fee,
    broadcast: async () => {
      throw new Error('not used by the builder');
    },
  };
}

const RETRY = { attempts: 1, delayMs: 0, timeoutMs: 5_000 };

describe('buildTronTx', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds an unsigned native TRX transfer', async () => {
    const calls = stubFetch(() => ({
      body: {
        txID: TX_ID,
        raw_data: { contract: [{ type: 'TransferContract' }] },
        raw_data_hex: RAW_DATA_HEX,
        visible: false,
      },
    }));

    const tx = await buildTronTx(
      {
        family: 'tron',
        chainId: 'tron',
        network: 'testnet',
        from: FROM,
        to: TO,
        amount: 25_000_000n,
      },
      { rpcUrls: ['https://nile.trongrid.io'], retry: RETRY },
    );

    expect(tx.family).toBe('tron');
    expect(tx.chainId).toBe('tron');
    expect(tx.network).toBe('testnet');
    expect(tx.serialized).toBeInstanceOf(Uint8Array);

    // meta.txID is a non-empty string.
    expect(tx.meta.txID).toBe(TX_ID);
    expect(typeof tx.meta.txID).toBe('string');
    expect((tx.meta.txID as string).length).toBeGreaterThan(0);
    expect(tx.meta.rawDataHex).toBe(RAW_DATA_HEX);

    // The signed object the signing phase needs is kept verbatim.
    const payload = JSON.parse(Buffer.from(tx.serialized as Uint8Array).toString('utf8')) as {
      txID: string;
    };
    expect(payload.txID).toBe(TX_ID);

    // TronGrid was called with hex addresses and the sun amount.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://nile.trongrid.io/wallet/createtransaction');
    expect(calls[0]?.body).toMatchObject({
      owner_address: '0x41abababababababababababababababababababab',
      to_address: '0x41cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
      amount: 25_000_000,
    });
    expect(tx.fee.maxCost).toBe(0n);
    expect(tx.meta.feeEstimated).toBe(false);
  });

  it('builds an unsigned TRC-20 transfer', async () => {
    const calls = stubFetch(() => ({
      body: {
        result: { result: true },
        transaction: { txID: TX_ID, raw_data: {}, raw_data_hex: RAW_DATA_HEX },
      },
    }));

    const tx = await buildTronTx(
      {
        family: 'tron',
        chainId: 'tron',
        network: 'testnet',
        from: FROM,
        to: TO,
        amount: 1_000_000n,
        token: { address: USDT, decimals: 6 },
      },
      { rpcUrls: ['https://nile.trongrid.io'], retry: RETRY },
    );

    expect(tx.meta.txID).toBe(TX_ID);
    expect(tx.meta.token).toBe(USDT);

    expect(calls[0]?.url).toBe('https://nile.trongrid.io/wallet/triggersmartcontract');
    expect(calls[0]?.body).toMatchObject({
      owner_address: '0x41abababababababababababababababababababab',
      contract_address: '0x41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
      function_selector: 'transfer(address,uint256)',
    });
    // ABI encoded: 32-byte address word + 32-byte amount word.
    const parameter = calls[0]?.body.parameter as string | undefined;
    expect(typeof parameter).toBe('string');
    expect(parameter).toHaveLength(128);
    expect(parameter).toMatch(/^[0-9a-f]{128}$/);
    // The word is left-padded: 11 zero bytes then the 21-byte TRON address.
    expect(parameter?.slice(0, 64)).toBe('0'.repeat(22) + '41' + 'cd'.repeat(20));
    expect(parameter?.slice(64)).toBe(1_000_000n.toString(16).padStart(64, '0'));

    // fee limit defaults to the constant-call floor.
    expect(tx.meta.feeLimit).toBe('100000000');
  });

  it('uses the connector fee as the fee limit floor', async () => {
    stubFetch(() => ({
      body: {
        result: { result: true },
        transaction: { txID: TX_ID, raw_data: {}, raw_data_hex: RAW_DATA_HEX },
      },
    }));

    const tx = await buildTronTx(
      {
        family: 'tron',
        chainId: 'tron',
        from: FROM,
        to: TO,
        amount: 1n,
        token: { address: USDT, decimals: 6 },
      },
      {
        rpcUrls: ['https://nile.trongrid.io'],
        retry: RETRY,
        connector: fakeConnector({ maxCost: 500_000_000n }),
      },
    );

    expect(tx.fee.maxCost).toBe(500_000_000n);
    expect(tx.meta.feeLimit).toBe('500000000');
  });

  it('falls back to the next endpoint when the primary is down', async () => {
    const calls = stubFetch((url) =>
      url.includes('primary')
        ? { status: 500, body: { error: 'node unavailable' } }
        : { body: { txID: TX_ID, raw_data: {}, raw_data_hex: RAW_DATA_HEX } },
    );

    const tx = await buildTronTx(
      { family: 'tron', chainId: 'tron', from: FROM, to: TO, amount: 1n },
      { rpcUrls: ['https://primary.example', 'https://fallback.example'], retry: RETRY },
    );

    expect(tx.meta.txID).toBe(TX_ID);
    expect(calls.map((call) => call.url)).toEqual([
      'https://primary.example/wallet/createtransaction',
      'https://fallback.example/wallet/createtransaction',
    ]);
  });

  it('maps a node rejection to BuilderError', async () => {
    stubFetch(() => ({
      body: {
        result: {
          result: false,
          code: 'SIGERROR',
          message: Buffer.from('bad signature', 'utf8').toString('hex'),
        },
      },
    }));

    await expect(
      buildTronTx(
        { family: 'tron', chainId: 'tron', from: FROM, to: TO, amount: 1n },
        { rpcUrls: ['https://nile.trongrid.io'], retry: RETRY },
      ),
    ).rejects.toThrow(/TronGrid rejected the transaction: SIGERROR bad signature/);
  });

  it('requires endpoints when the chain id is not the TRON registry id', async () => {
    await expect(
      buildTronTx(
        { family: 'tron', chainId: 'nile', from: FROM, to: TO, amount: 1n },
        { retry: RETRY },
      ),
    ).rejects.toThrow(/pass rpcUrls in the build options/);
  });

  it('rejects invalid addresses and negative amounts', async () => {
    await expect(
      buildTronTx(
        {
          family: 'tron',
          chainId: 'tron',
          from: 'TLLMHEG9hAsDRhnBYCMzGvGBNgSRuQBnFg',
          to: TO,
          amount: 1n,
        },
        { rpcUrls: ['https://nile.trongrid.io'], retry: RETRY },
      ),
    ).rejects.toThrow(BuilderError);

    await expect(
      buildTronTx(
        { family: 'tron', chainId: 'tron', from: FROM, to: TO, amount: -1n },
        { rpcUrls: ['https://nile.trongrid.io'], retry: RETRY },
      ),
    ).rejects.toThrow(/must not be negative/);
  });

  it('is reachable through buildTx', async () => {
    stubFetch(() => ({ body: { txID: TX_ID, raw_data: {}, raw_data_hex: RAW_DATA_HEX } }));

    const tx = await buildTx(
      { family: 'tron', chainId: 'tron', from: FROM, to: TO, amount: 1n },
      { rpcUrls: ['https://nile.trongrid.io'], retry: RETRY },
    );

    expect(tx.family).toBe('tron');
    expect(tx.meta.txID).toBe(TX_ID);
  });
});
