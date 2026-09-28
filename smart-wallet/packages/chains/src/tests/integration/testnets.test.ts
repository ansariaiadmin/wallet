import { describe, expect, it } from 'vitest';
import {
  CHAIN_IDS,
  createConnector,
  getChain,
  resolveRpcUrls,
  UnsupportedChainError,
} from '@chains';
import type { Balance, ChainId, FeeEstimate } from '@chains';

/**
 * Live tests against public testnet RPC endpoints.
 *
 * They are opt-in because public endpoints rate limit, go down and change their
 * URLs, which would make the default test run flaky:
 *
 *   RUN_INTEGRATION=1 pnpm --filter @wallet/chains test:integration
 *
 * Everything here is read-only: no private key is ever involved, and the
 * broadcast path is covered against the local mock in `test/unit` (a live
 * broadcast needs a funded account, which is out of scope for this layer).
 */
const enabled = process.env.RUN_INTEGRATION === '1';
const describeIfLive = enabled ? describe : describe.skip;

// Well known, long-lived addresses. Balances are not asserted because they
// change over time; only the shape and sanity of the answers are checked.
const ETH_SEPOLIA_ADDRESS = '0x00000000219ab540356cBB839Cbe05303d7705Fa';
const SOL_DEVNET_ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const TRON_NILE_ADDRESS = 'TRcvCk5fLxxgRc7KopfPXb3GzUqZMjcKkn';

const RETRY = { attempts: 2, delayMs: 10, timeoutMs: 20_000 };

describeIfLive('live testnet RPC', () => {
  it('exposes the supported chains', () => {
    expect(CHAIN_IDS).toContain('ethereum');
    expect(CHAIN_IDS).toContain('solana');
    expect(CHAIN_IDS).toContain('tron');
    expect(CHAIN_IDS.filter((id) => getChain(id).family === 'evm')).toHaveLength(6);
    expect(resolveRpcUrls('ethereum', { network: 'testnet' }).length).toBeGreaterThan(0);
    expect(resolveRpcUrls('solana', { network: 'testnet' })).toContain(
      'https://api.devnet.solana.com',
    );
    expect(resolveRpcUrls('tron', { network: 'testnet' })).toContain('https://nile.trongrid.io');
    expect(() => getChain('dogecoin' as unknown as ChainId)).toThrow(UnsupportedChainError);
  });

  it('reads an EVM testnet balance and estimates a fee', async () => {
    const connector = createConnector('ethereum', { network: 'testnet', retry: RETRY });

    const balance: Balance = await connector.getNativeBalance(ETH_SEPOLIA_ADDRESS);
    expect(balance.chainId).toBe('ethereum');
    expect(balance.network).toBe('testnet');
    expect(balance.unit).toBe('native');
    expect(typeof balance.amount).toBe('bigint');
    expect(balance.amount).toBeGreaterThanOrEqual(0n);

    const fee: FeeEstimate = await connector.estimateFee({
      from: ETH_SEPOLIA_ADDRESS,
      to: ETH_SEPOLIA_ADDRESS,
      amount: 1n,
    });
    expect(fee.chainId).toBe('ethereum');
    expect(fee.maxCost).toBeGreaterThan(0n);
  }, 60_000);

  it('reads a Solana devnet balance and estimates a fee', async () => {
    const connector = createConnector('solana', { network: 'testnet', retry: RETRY });

    const balance: Balance = await connector.getNativeBalance(SOL_DEVNET_ADDRESS);
    expect(balance.chainId).toBe('solana');
    expect(balance.symbol).toBe('SOL');
    expect(typeof balance.amount).toBe('bigint');
    expect(balance.amount).toBeGreaterThanOrEqual(0n);

    const fee: FeeEstimate = await connector.estimateFee({
      from: SOL_DEVNET_ADDRESS,
      to: SOL_DEVNET_ADDRESS,
      amount: 1n,
    });
    expect(fee.maxCost).toBeGreaterThan(0n);
  }, 60_000);

  it('reads a TRON Nile balance and estimates a fee', async () => {
    const connector = createConnector('tron', { network: 'testnet', retry: RETRY });

    const balance: Balance = await connector.getNativeBalance(TRON_NILE_ADDRESS);
    expect(balance.chainId).toBe('tron');
    expect(balance.network).toBe('testnet');
    expect(balance.symbol).toBe('TRX');
    expect(typeof balance.amount).toBe('bigint');
    expect(balance.amount).toBeGreaterThanOrEqual(0n);

    const fee: FeeEstimate = await connector.estimateFee({
      from: TRON_NILE_ADDRESS,
      to: TRON_NILE_ADDRESS,
      amount: 1n,
    });
    expect(fee.units).toBeGreaterThan(0n);
  }, 60_000);

  it('keeps working when a custom RPC endpoint is supplied', async () => {
    const connector = createConnector('ethereum', {
      network: 'testnet',
      rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'],
      retry: RETRY,
    });

    const balance = await connector.getNativeBalance(ETH_SEPOLIA_ADDRESS);
    expect(balance.network).toBe('testnet');
  }, 60_000);
});

describe('live testnet RPC (skipped)', () => {
  it('is opt-in through RUN_INTEGRATION=1', () => {
    expect(enabled).toBe(false);
  });
});
