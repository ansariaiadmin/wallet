import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ChainsModule from '@wallet/chains';
import type {
  Balance,
  BroadcastResult,
  ChainConnector,
  ChainId,
  FeeEstimate,
  Network,
} from '@wallet/chains';
import { SmartWallet, SdkError } from '../index';
import type { BroadcastResult as SdkBroadcastResult, TxStatusResult } from '../index';
import { resetTxRecords } from '../tx-status';

/**
 * The connector the mocked `@wallet/chains` hands back. `vi.mock` is hoisted,
 * so the factory only reads this variable when a connector is asked for — long
 * after the test file has been evaluated.
 */
let current: FakeConnector | undefined;

vi.mock('@wallet/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof ChainsModule>();
  return {
    ...actual,
    createConnector: (): ChainConnector => {
      if (current === undefined) {
        throw new Error('no connector configured for this test');
      }
      return current;
    },
  };
});

const EVM_HASH = '0x9c3b2d1e5f7a8b4c6d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c';
const OTHER_EVM_HASH = '0x1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f8091';
const SOL_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const TRON_HASH = '9c3b2d1e5f7a8b4c6d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c';

/** A signed transaction: raw bytes, as the SDK's signer returns them. */
const SIGNED_BYTES = Uint8Array.from([0x02, 0xf8, 0x01, 0x82, 0x52, 0x08]);
const SIGNED_HEX = `0x${Buffer.from(SIGNED_BYTES).toString('hex')}`;
const SIGNED_BASE64 = Buffer.from(SIGNED_BYTES).toString('base64');

/** Connector double that records the payload it was handed. */
class FakeConnector implements ChainConnector {
  readonly broadcasted: string[] = [];
  failure: Error | undefined;

  constructor(
    private readonly chain: ChainId,
    private readonly hash: string,
  ) {}

  async broadcast(signedTransaction: string): Promise<BroadcastResult> {
    this.broadcasted.push(signedTransaction);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return { chainId: this.chain, network: 'mainnet', txHash: this.hash };
  }

  async getNativeBalance(): Promise<Balance> {
    throw new Error('not used by these tests');
  }

  async getTokenBalances(): Promise<readonly Balance[]> {
    throw new Error('not used by these tests');
  }

  async estimateFee(): Promise<FeeEstimate> {
    throw new Error('not used by these tests');
  }

  get chainId(): ChainId {
    return this.chain;
  }

  get network(): Network {
    return 'mainnet';
  }
}

/** Connector double that can read a transaction back, like a live chain. */
class ReadingConnector extends FakeConnector {
  constructor(
    chain: ChainId,
    hash: string,
    private readonly read: () => Promise<unknown>,
  ) {
    super(chain, hash);
  }

  async getTransactionStatus(): Promise<unknown> {
    return this.read();
  }
}

/** A wallet whose connector is the current double. */
function wallet(): SmartWallet {
  return new SmartWallet();
}

/** Runs `body` with `connector` as the connector every network resolves to. */
async function withConnector<T>(connector: FakeConnector, body: () => Promise<T>): Promise<T> {
  current = connector;
  try {
    return await body();
  } finally {
    current = undefined;
  }
}

/** Asserts the rejection is an SdkError with `code`. */
async function expectCode(run: () => Promise<unknown>, code: string): Promise<void> {
  await expect(run()).rejects.toMatchObject({ code });
  await expect(run()).rejects.toBeInstanceOf(SdkError);
}

beforeEach(() => {
  current = undefined;
  resetTxRecords();
});

describe('SmartWallet.broadcast', () => {
  it('broadcasts an EVM transaction and reports the hash', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);

    const result = await withConnector(connector, () =>
      wallet().broadcast('ethereum', SIGNED_BYTES),
    );

    expect(result.txHash).toBe(EVM_HASH);
    expect(result.network).toBe('ethereum');
    expect(typeof result.broadcastAt).toBe('number');
    expect(result.broadcastAt).toBeGreaterThan(1_700_000_000);
  });

  it('encodes an EVM payload as 0x-prefixed hex', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);

    await withConnector(connector, () => wallet().broadcast('ethereum', SIGNED_BYTES));

    expect(connector.broadcasted).toEqual([SIGNED_HEX]);
  });

  it('encodes a Solana payload as base64', async () => {
    const connector = new FakeConnector('solana', SOL_HASH);

    const result = await withConnector(connector, () => wallet().broadcast('solana', SIGNED_BYTES));

    expect(connector.broadcasted).toEqual([SIGNED_BASE64]);
    expect(result.network).toBe('solana');
    expect(result.txHash).toBe(SOL_HASH);
  });

  it('keeps two broadcasts independent', async () => {
    const first = new FakeConnector('ethereum', EVM_HASH);
    const second = new FakeConnector('ethereum', OTHER_EVM_HASH);

    const one = await withConnector(first, () => wallet().broadcast('ethereum', SIGNED_BYTES));
    const two = await withConnector(second, () => wallet().broadcast('ethereum', SIGNED_BYTES));

    expect(one.txHash).toBe(EVM_HASH);
    expect(two.txHash).toBe(OTHER_EVM_HASH);
    expect(one.txHash).not.toBe(two.txHash);
  });

  it('rejects an unknown network with SdkError UNSUPPORTED_NETWORK', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);

    await withConnector(connector, () =>
      expectCode(
        () => wallet().broadcast('dogecoin' as never, SIGNED_BYTES),
        'UNSUPPORTED_NETWORK',
      ),
    );
  });

  it('rejects a network that is not enabled', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);

    await withConnector(connector, () =>
      expectCode(
        () => new SmartWallet({ networks: ['solana'] }).broadcast('ethereum', SIGNED_BYTES),
        'NETWORK_NOT_ENABLED',
      ),
    );
  });

  it('rejects a payload that is not a Uint8Array', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);

    await withConnector(connector, () =>
      expectCode(() => wallet().broadcast('ethereum', SIGNED_HEX as never), 'INVALID_INPUT'),
    );
  });

  it('rejects an empty payload', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);

    await withConnector(connector, () =>
      expectCode(() => wallet().broadcast('ethereum', new Uint8Array()), 'INVALID_INPUT'),
    );
  });

  it('maps a connector rejection onto SdkError BROADCAST_FAILED', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);
    connector.failure = new Error('nonce too low');

    await withConnector(connector, () =>
      expectCode(() => wallet().broadcast('ethereum', SIGNED_BYTES), 'BROADCAST_FAILED'),
    );
  });

  it('reports TRON as SdkError BROADCAST_FAILED without touching the connector', async () => {
    const connector = new FakeConnector('tron', TRON_HASH);

    // TronGrid broadcasts the signed transaction object as JSON; raw bytes
    // cannot be turned into that offline, so the SDK fails loudly instead.
    await withConnector(connector, async () => {
      await expectCode(() => wallet().broadcast('tron', SIGNED_BYTES), 'BROADCAST_FAILED');
      expect(connector.broadcasted).toEqual([]);
    });
  });

  it('never logs the payload it forwards', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await withConnector(connector, () => wallet().broadcast('ethereum', SIGNED_BYTES));
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('SmartWallet.getTxStatus', () => {
  it('reports a broadcast transaction as pending', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);

    const result = await withConnector(connector, async () => {
      await wallet().broadcast('ethereum', SIGNED_BYTES);
      return wallet().getTxStatus('ethereum', EVM_HASH);
    });

    expect(result.txHash).toBe(EVM_HASH);
    expect(result.network).toBe('ethereum');
    expect(result.status).toBe('pending');
    expect(result.confirmations).toBe(0);
    expect(typeof result.checkedAt).toBe('number');
    expect(result.checkedAt).toBeGreaterThan(1_700_000_000);
  });

  it('reports a confirmed transaction with its confirmations', async () => {
    const connector = new ReadingConnector('ethereum', EVM_HASH, async () => ({
      status: 'confirmed',
      confirmations: 12,
    }));

    const result = await withConnector(connector, () => wallet().getTxStatus('ethereum', EVM_HASH));

    expect(result.status).toBe('confirmed');
    expect(result.confirmations).toBe(12);
  });

  it('reports not_found for a transaction it never saw', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);

    const result = await withConnector(connector, () =>
      wallet().getTxStatus('ethereum', OTHER_EVM_HASH),
    );

    expect(result.status).toBe('not_found');
    expect(result.confirmations).toBe(0);
    expect(typeof result.checkedAt).toBe('number');
  });

  it('rejects an unknown network with SdkError UNSUPPORTED_NETWORK', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);

    await withConnector(connector, () =>
      expectCode(() => wallet().getTxStatus('dogecoin' as never, EVM_HASH), 'UNSUPPORTED_NETWORK'),
    );
  });

  it('rejects an empty hash with SdkError INVALID_INPUT', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);

    await withConnector(connector, () =>
      expectCode(() => wallet().getTxStatus('ethereum', '   '), 'INVALID_INPUT'),
    );
  });

  it('maps a connector rejection onto SdkError STATUS_FAILED', async () => {
    const connector = new ReadingConnector('ethereum', EVM_HASH, async () => {
      throw new Error('endpoint unreachable');
    });

    await withConnector(connector, () =>
      expectCode(() => wallet().getTxStatus('ethereum', EVM_HASH), 'STATUS_FAILED'),
    );
  });

  it('tracks a Solana transaction separately from an EVM one', async () => {
    const connector = new FakeConnector('solana', SOL_HASH);

    const result = await withConnector(connector, async () => {
      await wallet().broadcast('solana', SIGNED_BYTES);
      return wallet().getTxStatus('solana', SOL_HASH);
    });

    expect(result.network).toBe('solana');
    expect(result.status).toBe('pending');
  });
});

describe('SDK broadcast surface', () => {
  it('exports BroadcastResult and TxStatusResult from the package entry', () => {
    // The types below only compile when the package entry exports them.
    const broadcast: SdkBroadcastResult = {
      txHash: EVM_HASH,
      network: 'ethereum',
      broadcastAt: 1,
    };
    const status: TxStatusResult = {
      txHash: EVM_HASH,
      network: 'ethereum',
      status: 'pending',
      confirmations: 0,
      checkedAt: 1,
    };

    expect(broadcast.network).toBe('ethereum');
    expect(status.status).toBe('pending');
  });

  it('exposes broadcast and getTxStatus on every wallet', () => {
    const instance = new SmartWallet();

    expect(typeof instance.broadcast).toBe('function');
    expect(typeof instance.getTxStatus).toBe('function');
  });
});
