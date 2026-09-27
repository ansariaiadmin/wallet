import { afterEach, describe, expect, it } from 'vitest';
import { createConnector } from '@chains/registry';
import { AllRpcEndpointsFailedError, InvalidAddressError } from '@chains/errors';
import { isTronAddress, tronFromHex, tronToHex } from '@chains/address';

// Valid base58check addresses derived from arbitrary hex (deterministic fixtures).
const OWNER = tronFromHex(`0x41${'ab'.repeat(20)}`);
const RECIPIENT = tronFromHex(`0x41${'cd'.repeat(20)}`);
const TOKEN = tronFromHex(`0x41${'ef'.repeat(20)}`);
import { decodeTronString, hexToBigInt } from '@chains/tron';
import { startMockServer, type MockServer } from './mock';

const RETRY = { attempts: 2, delayMs: 0, timeoutMs: 5_000 };

function connectorFor(url: string) {
  return createConnector('tron', { network: 'testnet', rpcUrls: [url], retry: RETRY });
}

/** Builds a `triggerconstantcontract` response. */
function constantCall(value: string, energyUsed = 0) {
  return { result: { result: true }, constant_result: [value], energy_used: energyUsed };
}

describe('TronConnector', () => {
  const servers: MockServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serve(routes: Record<string, (body: unknown) => unknown>) {
    const server = await startMockServer((path, body) => ({
      body: routes[path] === undefined ? {} : routes[path](body),
    }));
    servers.push(server);
    return server;
  }

  it('reads the native TRX balance in sun', async () => {
    const server = await serve({
      '/wallet/getaccount': () => ({ balance: 12_345_678, address: tronToHex(OWNER) }),
    });

    const balance = await connectorFor(server.url).getNativeBalance(OWNER);

    expect(balance.unit).toBe('native');
    expect(balance.symbol).toBe('TRX');
    expect(balance.decimals).toBe(6);
    expect(balance.amount).toBe(12_345_678n);
    expect(balance.formatted).toBe('12.345678');
  });

  it('treats unknown accounts as zero balance', async () => {
    const server = await serve({ '/wallet/getaccount': () => ({}) });

    const balance = await connectorFor(server.url).getNativeBalance(OWNER);

    expect(balance.amount).toBe(0n);
    expect(balance.formatted).toBe('0');
  });

  it('reads TRC-20 balances with decimals and symbol', async () => {
    const server = await serve({
      '/wallet/triggerconstantcontract': (body) => {
        const call = body as { function_selector: string };
        switch (call.function_selector) {
          case 'balanceOf(address)':
            return constantCall('0x' + 5_000_000n.toString(16).padStart(64, '0'));
          case 'decimals()':
            return constantCall('0x' + 6n.toString(16).padStart(64, '0'));
          case 'symbol()':
            return constantCall(
              '0x' +
                [32, 4].map((word) => word.toString(16).padStart(64, '0')).join('') +
                Buffer.from('USDT', 'utf8').toString('hex').padEnd(64, '0'),
            );
          default:
            throw new Error(`unexpected selector ${call.function_selector}`);
        }
      },
    });

    const balances = await connectorFor(server.url).getTokenBalances(OWNER, [TOKEN]);

    expect(balances).toHaveLength(1);
    expect(balances[0]).toMatchObject({
      unit: 'token',
      symbol: 'USDT',
      decimals: 6,
      amount: 5_000_000n,
      formatted: '5',
      tokenAddress: TOKEN,
    });
  });

  it('estimates a TRX transfer fee from available bandwidth', async () => {
    const server = await serve({
      '/wallet/getaccount': () => ({ balance: 1_000_000, free_net_limit: 600, net_limit: 0 }),
    });

    const fee = await connectorFor(server.url).estimateFee({ from: OWNER, to: RECIPIENT });

    // 600 free bandwidth does not cover the 265 needed? It does: cost is zero.
    expect(fee.units).toBe(265n);
    expect(fee.maxCost).toBe(0n);
    expect(fee.formattedMaxCost).toBe('0');
  });

  it('burns TRX when bandwidth is insufficient', async () => {
    const server = await serve({
      '/wallet/getaccount': () => ({ balance: 1_000_000, free_net_limit: 0, net_limit: 0 }),
    });

    const fee = await connectorFor(server.url).estimateFee({ from: OWNER, to: RECIPIENT });

    expect(fee.maxCost).toBe(100_000n);
    expect(fee.formattedMaxCost).toBe('0.1');
  });

  it('estimates a TRC-20 transfer fee from energy usage', async () => {
    const server = await serve({
      '/wallet/triggerconstantcontract': () => constantCall('0x', 31_895),
      '/wallet/getchainparameters': () => ({
        chainParameter: [
          { key: 'getMaxCpuTimeOfOneTx', value: 80 },
          { key: 'getEnergyFee', value: 420 },
        ],
      }),
    });

    const fee = await connectorFor(server.url).estimateFee({
      from: OWNER,
      to: RECIPIENT,
      token: TOKEN,
      amount: 1_000_000n,
    });

    expect(fee.details?.energyUsed).toBe('31895');
    expect(fee.details?.energyPriceSun).toBe('420');
    expect(fee.maxCost).toBe(100_000n + 31_895n * 420n);
    expect(fee.formattedMaxCost).toBe('13.4959');
  });

  it('broadcasts a signed transaction object and returns the txid', async () => {
    const server = await serve({
      '/wallet/broadcasttransaction': () => ({
        result: { result: true },
        txid: 'd1c9a4b3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5',
      }),
    });

    const result = await connectorFor(server.url).broadcast(
      JSON.stringify({ visible: false, txID: 'abc', raw_data: {}, signature: ['aa'] }),
    );

    expect(result.txHash).toBe('d1c9a4b3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5');
    expect(result.explorerUrl).toContain('/#/transaction/');
  });

  it('rejects a signed payload that is not JSON', async () => {
    const server = await serve({});

    await expect(connectorFor(server.url).broadcast('0xdeadbeef')).rejects.toThrow(
      /must be a JSON string/,
    );
  });

  it('maps a node rejection to BroadcastError', async () => {
    const server = await serve({
      '/wallet/broadcasttransaction': () => ({
        result: {
          result: false,
          code: 'SIGERROR',
          message: Buffer.from('bad signature', 'utf8').toString('hex'),
        },
      }),
    });

    await expect(
      connectorFor(server.url).broadcast(JSON.stringify({ txID: 'abc' })),
    ).rejects.toThrow(/node rejected the transaction: SIGERROR bad signature/);
  });

  it('falls back to the next endpoint when the primary is down', async () => {
    const primary = await serve({});
    const secondary = await serve({
      '/wallet/getaccount': () => ({ balance: 777 }),
    });

    // Make the primary fail by closing it before the call.
    await primary.close();

    const connector = createConnector('tron', {
      network: 'testnet',
      rpcUrls: [primary.url, secondary.url],
      retry: RETRY,
    });

    const balance = await connector.getNativeBalance(OWNER);

    expect(balance.amount).toBe(777n);
  });

  it('fails with AllRpcEndpointsFailedError when every endpoint is down', async () => {
    const first = await serve(deadNodeRoutes());
    const second = await serve(deadNodeRoutes());

    const connector = createConnector('tron', {
      network: 'testnet',
      rpcUrls: [first.url, second.url],
      retry: RETRY,
    });

    await expect(connector.getNativeBalance(OWNER)).rejects.toThrow(AllRpcEndpointsFailedError);
  });

  it('rejects malformed addresses', async () => {
    const server = await serve({});

    await expect(connectorFor(server.url).getNativeBalance('TXXXX')).rejects.toThrow(
      InvalidAddressError,
    );
  });

  it('round-trips TRON addresses between base58 and hex', () => {
    const hex = tronToHex(OWNER);

    expect(hex).toMatch(/^0x41[0-9a-f]{40}$/);
    expect(tronFromHex(hex)).toBe(OWNER);
    expect(isTronAddress(OWNER)).toBe(true);
    expect(isTronAddress(RECIPIENT)).toBe(true);
    expect(isTronAddress(OWNER.slice(0, -1))).toBe(false);
    expect(isTronAddress('0x1234')).toBe(false);
  });

  it('decodes hex words and ABI strings', () => {
    expect(hexToBigInt('0x0a')).toBe(10n);
    expect(hexToBigInt('')).toBe(0n);
    expect(decodeTronString('0x' + 6n.toString(16).padStart(64, '0'))).toBeNull();
    expect(decodeTronString('0x' + Buffer.from('USDT').toString('hex').padEnd(64, '0'))).toBe(
      'USDT',
    );
    expect(
      decodeTronString(
        '0x' +
          [32, 3].map((w) => w.toString(16).padStart(64, '0')).join('') +
          Buffer.from('BTC', 'utf8').toString('hex').padEnd(64, '0'),
      ),
    ).toBe('BTC');
  });
});

function deadNodeRoutes(): Record<string, () => never> {
  return {
    '/wallet/getaccount': () => {
      throw new Error('node unavailable');
    },
  };
}
