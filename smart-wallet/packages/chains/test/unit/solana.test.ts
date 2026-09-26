import { afterEach, describe, expect, it } from 'vitest';
import { createConnector } from '@chains/registry';
import { AllRpcEndpointsFailedError, InvalidAddressError } from '@chains/errors';
import { decodeSignedTransaction } from '@chains/solana';
import { deadNode, jsonRpcHandler, startMockServer, type MockServer } from './mock';

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'; // well-known devnet address
const RECIPIENT = '11111111111111111111111111111111'; // System Program id, valid base58
const MINT_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SIGNATURE =
  '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQU';

const RETRY = { attempts: 2, delayMs: 0, timeoutMs: 5_000 };

function connectorFor(url: string) {
  return createConnector('solana', { network: 'testnet', rpcUrls: [url], retry: RETRY });
}

describe('SolanaConnector', () => {
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

  it('reads the native SOL balance', async () => {
    const server = await serve(
      jsonRpcHandler((method) => {
        if (method === 'getBalance') return { context: { slot: 1 }, value: 1_500_000_000n };
        throw new Error(`unexpected method ${method}`);
      }),
    );

    const balance = await connectorFor(server.url).getNativeBalance(WALLET);

    expect(balance.unit).toBe('native');
    expect(balance.symbol).toBe('SOL');
    expect(balance.decimals).toBe(9);
    expect(balance.amount).toBe(1_500_000_000n);
    expect(balance.formatted).toBe('1.5');
  });

  it('reads SPL token balances and filters by requested mints', async () => {
    const tokenAccount = (mint: string, amount: string, decimals: number) => ({
      pubkey: 'CtcDkuLxYjP9mY1SjGLCzQBhgrXoUv6nUqMTRvxWY7Pn',
      account: {
        executable: false,
        owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        lamports: 2_039_280n,
        rentEpoch: 331,
        data: {
          program: 'spl-token',
          space: 165,
          parsed: {
            type: 'account',
            info: {
              mint,
              tokenAmount: { amount, decimals, uiAmount: Number(amount) / 10 ** decimals },
            },
          },
        },
      },
    });

    const server = await serve(
      jsonRpcHandler((method, params) => {
        if (method === 'getTokenAccountsByOwner') {
          // The connector asks both the classic SPL program and Token-2022.
          const programId = (params[1] as { programId?: string } | undefined)?.programId;
          const isClassic = programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
          return {
            context: { slot: 1 },
            value: isClassic ? [tokenAccount(MINT_USDC, '2500000', 6)] : [],
          };
        }
        throw new Error(`unexpected method ${method}`);
      }),
    );

    const all = await connectorFor(server.url).getTokenBalances(WALLET);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      unit: 'token',
      decimals: 6,
      amount: 2_500_000n,
      formatted: '2.5',
      tokenAddress: MINT_USDC,
    });

    const filtered = await connectorFor(server.url).getTokenBalances(WALLET, [MINT_USDC]);
    expect(filtered).toHaveLength(1);

    const other = await connectorFor(server.url).getTokenBalances(WALLET, [RECIPIENT]);
    expect(other).toHaveLength(0);
  });

  it('estimates the fee for a transfer', async () => {
    const server = await serve(
      jsonRpcHandler((method) => {
        if (method === 'getLatestBlockhash')
          return {
            context: { slot: 1 },
            value: {
              blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
              lastValidBlockHeight: 100,
            },
          };
        if (method === 'getFeeForMessage') return { context: { slot: 1 }, value: 5000n };
        throw new Error(`unexpected method ${method}`);
      }),
    );

    const fee = await connectorFor(server.url).estimateFee({
      from: WALLET,
      to: RECIPIENT,
      amount: 100_000_000n,
    });

    expect(fee.chainId).toBe('solana');
    expect(fee.nativeSymbol).toBe('SOL');
    expect(fee.units).toBe(1n);
    expect(fee.maxCost).toBe(5000n);
    expect(fee.formattedMaxCost).toBe('0.000005');
    expect(fee.details?.ataRentExcluded).toBe('true');
  });

  it('broadcasts a signed transaction and returns the signature', async () => {
    const server = await serve(
      jsonRpcHandler((method) => {
        if (method === 'sendTransaction') return SIGNATURE;
        throw new Error(`unexpected method ${method}`);
      }),
    );

    const result = await connectorFor(server.url).broadcast(
      Buffer.from('signed-tx').toString('base64'),
    );

    expect(result.txHash).toBe(SIGNATURE);
    expect(result.explorerUrl).toContain(SIGNATURE);
  });

  it('decodes base64 and hex signed transactions', () => {
    expect(decodeSignedTransaction(Buffer.from('hello').toString('base64')).toString()).toBe(
      'hello',
    );
    expect(decodeSignedTransaction('0x68656c6c6f').toString()).toBe('hello');
    expect(() => decodeSignedTransaction('!!!not-valid!!!')).toThrow(/base64 or 0x-prefixed hex/);
  });

  it('falls back to the next endpoint when the primary is down', async () => {
    const primary = await serve(deadNode());
    const secondary = await serve(
      jsonRpcHandler((method) => {
        if (method === 'getBalance') return { context: { slot: 1 }, value: 99n };
        throw new Error(`unexpected method ${method}`);
      }),
    );

    const connector = createConnector('solana', {
      network: 'testnet',
      rpcUrls: [primary.url, secondary.url],
      retry: RETRY,
    });

    const balance = await connector.getNativeBalance(WALLET);

    expect(balance.amount).toBe(99n);
    expect(primary.requests.length).toBeGreaterThan(0);
    expect(secondary.requests.length).toBeGreaterThan(0);
  });

  it('fails with AllRpcEndpointsFailedError when every endpoint is down', async () => {
    const first = await serve(deadNode());
    const second = await serve(deadNode());

    const connector = createConnector('solana', {
      network: 'testnet',
      rpcUrls: [first.url, second.url],
      retry: RETRY,
    });

    await expect(connector.getNativeBalance(WALLET)).rejects.toThrow(AllRpcEndpointsFailedError);
  });

  it('rejects malformed addresses', async () => {
    const server = await serve(jsonRpcHandler(() => ({ context: { slot: 1 }, value: 0n })));

    await expect(connectorFor(server.url).getNativeBalance('not-a-solana-address')).rejects.toThrow(
      InvalidAddressError,
    );
  });
});
