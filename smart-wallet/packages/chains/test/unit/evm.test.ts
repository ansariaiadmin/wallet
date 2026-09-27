import { afterEach, describe, expect, it } from 'vitest';
import { createConnector } from '@chains/registry';
import { AllRpcEndpointsFailedError, InvalidAddressError } from '@chains/errors';
import { formatUnits } from '@chains/format';
import { deadNode, JsonRpcError, jsonRpcHandler, startMockServer, type MockServer } from './mock';

const ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const TOKEN_A = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // 6 decimals
const TOKEN_B = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // 6 decimals
const TX_HASH = '0x9c6c21ef9b56a78d1c1cd8c4a1c0c1e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d';

const RETRY = { attempts: 2, delayMs: 0, timeoutMs: 5_000 };

function connectorFor(url: string, chainId: Parameters<typeof createConnector>[0] = 'ethereum') {
  return createConnector(chainId, { rpcUrls: [url], retry: RETRY });
}

/** ABI helpers for the mock eth_call responses. */
function encodeUint256(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function encodeString(value: string): string {
  const data = Buffer.from(value, 'utf8').toString('hex').padEnd(64, '0');
  return `0x${[32, value.length].map((word) => word.toString(16).padStart(64, '0')).join('')}${data}`;
}

describe('EvmConnector', () => {
  const servers: MockServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serve(
    handler: (path: string, body: unknown) => { status?: number; body: unknown },
  ) {
    const server = await startMockServer(handler);
    servers.push(server);
    return server;
  }

  it('reads the native balance', async () => {
    const server = await serve(
      jsonRpcHandler((method) => {
        if (method === 'eth_getBalance') return encodeUint256(10n ** 18n);
        throw new Error(`unexpected method ${method}`);
      }),
    );

    const balance = await connectorFor(server.url).getNativeBalance(ADDRESS);

    expect(balance.unit).toBe('native');
    expect(balance.symbol).toBe('ETH');
    expect(balance.decimals).toBe(18);
    expect(balance.amount).toBe(10n ** 18n);
    expect(balance.formatted).toBe('1');
  });

  it('reads ERC-20 balances for the requested tokens', async () => {
    const server = await serve(
      jsonRpcHandler((method, params) => {
        if (method !== 'eth_call') throw new Error(`unexpected method ${method}`);
        const call = params[0] as { to: string; data: string };
        const token = call.to.toLowerCase();
        if (token === TOKEN_A.toLowerCase()) {
          if (call.data.startsWith('0x70a08231')) return encodeUint256(1_500_000n); // balanceOf
          if (call.data.startsWith('0x313ce567')) return encodeUint256(6n); // decimals
          return encodeString('USDC');
        }
        if (token === TOKEN_B.toLowerCase()) {
          if (call.data.startsWith('0x70a08231')) return encodeUint256(2_000_000_000n);
          if (call.data.startsWith('0x313ce567')) return encodeUint256(6n);
          return encodeString('USDT');
        }
        throw new Error(`unexpected token ${call.to}`);
      }),
    );

    const balances = await connectorFor(server.url).getTokenBalances(ADDRESS, [TOKEN_A, TOKEN_B]);

    expect(balances).toHaveLength(2);
    expect(balances[0]).toMatchObject({
      unit: 'token',
      symbol: 'USDC',
      decimals: 6,
      amount: 1_500_000n,
      tokenAddress: TOKEN_A,
    });
    expect(balances[0]?.formatted).toBe('1.5');
    expect(balances[1]).toMatchObject({ symbol: 'USDT', amount: 2_000_000_000n });
  });

  it('returns no tokens when ERC-20 enumeration is requested without a list', async () => {
    const server = await serve(jsonRpcHandler(() => encodeUint256(0n)));

    await expect(connectorFor(server.url).getTokenBalances(ADDRESS)).resolves.toEqual([]);
  });

  it('surfaces ERC-20 read failures with the token address', async () => {
    const server = await serve(
      jsonRpcHandler(() => {
        throw new Error('execution reverted');
      }),
    );

    await expect(connectorFor(server.url).getTokenBalances(ADDRESS, [TOKEN_A])).rejects.toThrow(
      /Failed to read ERC-20 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/,
    );
  });

  it('estimates the fee as gas limit times gas price', async () => {
    const server = await serve(
      jsonRpcHandler((method) => {
        if (method === 'eth_estimateGas') return encodeUint256(21_000n);
        if (method === 'eth_gasPrice') return encodeUint256(30_000_000_000n); // 30 gwei
        if (method === 'eth_maxPriorityFeePerGas') return encodeUint256(1_000_000_000n);
        if (method === 'eth_getBlockByNumber')
          return { baseFeePerGas: encodeUint256(20_000_000_000n) };
        throw new Error(`unexpected method ${method}`);
      }),
    );

    const fee = await connectorFor(server.url).estimateFee({
      from: ADDRESS,
      to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      amount: 10n ** 17n,
    });

    expect(fee.chainId).toBe('ethereum');
    expect(fee.units).toBe(21_000n);
    expect(fee.unitPrice).toBeGreaterThan(0n);
    expect(fee.maxCost).toBe(fee.units * fee.unitPrice);
    expect(fee.formattedMaxCost).toBe(formatUnits(fee.maxCost, 18));
    expect(fee.details?.l1DataFeeIncluded).toBe('false');
  });

  it('broadcasts a signed transaction and returns the hash plus explorer link', async () => {
    const server = await serve(
      jsonRpcHandler((method) => {
        if (method === 'eth_sendRawTransaction') return TX_HASH;
        throw new Error(`unexpected method ${method}`);
      }),
    );

    const result = await connectorFor(server.url).broadcast(`0x02f8${'ab'.repeat(50)}`);

    expect(result.txHash).toBe(TX_HASH);
    expect(result.chainId).toBe('ethereum');
    expect(result.network).toBe('mainnet');
    expect(result.explorerUrl).toBe(`https://etherscan.io/tx/${TX_HASH}`);
  });

  it('maps a rejected broadcast to BroadcastError', async () => {
    const server = await serve(
      jsonRpcHandler((method) => {
        if (method === 'eth_sendRawTransaction') {
          throw new JsonRpcError(-32000, 'insufficient funds for intrinsic transaction cost');
        }
        throw new Error(`unexpected method ${method}`);
      }),
    );

    await expect(connectorFor(server.url).broadcast('0x02f8ab')).rejects.toThrow(
      /Broadcast rejected: insufficient funds/,
    );
  });

  it('falls back to the next endpoint when the primary is down', async () => {
    const primary = await serve(deadNode());
    const secondary = await serve(
      jsonRpcHandler((method) => {
        if (method === 'eth_getBalance') return encodeUint256(42n);
        throw new Error(`unexpected method ${method}`);
      }),
    );

    const connector = createConnector('ethereum', {
      rpcUrls: [primary.url, secondary.url],
      retry: RETRY,
    });

    const balance = await connector.getNativeBalance(ADDRESS);

    expect(balance.amount).toBe(42n);
    expect(primary.requests.length).toBeGreaterThan(0);
    expect(secondary.requests.length).toBeGreaterThan(0);
  });

  it('fails with AllRpcEndpointsFailedError when every endpoint is down', async () => {
    const first = await serve(deadNode());
    const second = await serve(deadNode());

    const connector = createConnector('ethereum', {
      rpcUrls: [first.url, second.url],
      retry: RETRY,
    });

    await expect(connector.getNativeBalance(ADDRESS)).rejects.toThrow(AllRpcEndpointsFailedError);
  });

  it('retries a flaky endpoint before giving up on it', async () => {
    let attempts = 0;
    const server = await serve(
      jsonRpcHandler((method) => {
        if (method === 'eth_getBalance') {
          attempts += 1;
          if (attempts === 1) throw new Error('temporary node error');
          return encodeUint256(7n);
        }
        throw new Error(`unexpected method ${method}`);
      }),
    );

    const balance = await connectorFor(server.url).getNativeBalance(ADDRESS);

    expect(balance.amount).toBe(7n);
    expect(attempts).toBe(2);
  });

  it('rejects malformed addresses', async () => {
    const server = await serve(jsonRpcHandler(() => encodeUint256(0n)));

    await expect(connectorFor(server.url).getNativeBalance('not-an-address')).rejects.toThrow(
      InvalidAddressError,
    );
  });

  it('uses the testnet explorer for testnet connectors', async () => {
    const server = await serve(
      jsonRpcHandler((method) => {
        if (method === 'eth_sendRawTransaction') return TX_HASH;
        throw new Error(`unexpected method ${method}`);
      }),
    );

    const connector = createConnector('base', {
      network: 'testnet',
      rpcUrls: [server.url],
      retry: RETRY,
    });

    const result = await connector.broadcast('0x02f8ab');

    expect(result.network).toBe('testnet');
    expect(result.explorerUrl).toBe(`https://sepolia.basescan.org/tx/${TX_HASH}`);
  });
});
