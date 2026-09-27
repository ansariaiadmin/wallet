import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type {
  Balance,
  BroadcastResult,
  ChainConnector,
  ChainId,
  FeeEstimate,
  Network,
} from '@wallet/chains';
import { createApp, withErrorHandler } from '../app';
import { broadcastRoutes, statusRoutes } from '../routes/broadcast';
import { TxStore, txKey } from '../tx-status';

/** A 32-byte hash, the shape every family reports. */
const EVM_HASH = '0x9c3b2d1e5f7a8b4c6d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c';
const TRON_HASH = '9c3b2d1e5f7a8b4c6d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c';
const SOL_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
/** A second EVM hash, for the "two independent broadcasts" case. */
const OTHER_EVM_HASH = '0x1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f8091';
const OTHER_SOL_HASH = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/** A signed EVM transaction: 0x-prefixed RLP, truncated here. */
const SIGNED_EVM = `0x02f8${'ab'.repeat(64)}`;
/** A signed Solana transaction: base64 of the same bytes. */
const SIGNED_SOL = Buffer.from('f8'.repeat(64), 'hex').toString('base64');

/** Connector double that records what it was asked to broadcast. */
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
    throw new Error('not used by these routes');
  }

  async getTokenBalances(): Promise<readonly Balance[]> {
    throw new Error('not used by these routes');
  }

  async estimateFee(): Promise<FeeEstimate> {
    throw new Error('not used by these routes');
  }

  get chainId(): ChainId {
    return this.chain;
  }

  get network(): Network {
    return 'mainnet';
  }
}

/** Connector double that can read a transaction back. */
class ReadingConnector extends FakeConnector {
  constructor(
    chain: ChainId,
    private readonly reader: () => Promise<unknown>,
  ) {
    super(chain, EVM_HASH);
  }

  async getTransactionStatus(): Promise<unknown> {
    return this.reader();
  }
}

/** POSTs a JSON body and returns status plus parsed body. */
async function post(
  app: Hono,
  path: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

/** GETs a path and returns status plus parsed body. */
async function get(
  app: Hono,
  path: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await app.request(path);
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

/** App with an injected connector, so nothing ever reaches a node. */
function appWith(connector: ChainConnector, store = new TxStore()): Hono {
  const app = withErrorHandler(new Hono());
  app.route('/api/v1', broadcastRoutes({ connector: () => connector, store }));
  app.route('/api/v1', statusRoutes({ connector: () => connector, store }));
  return app;
}

describe('POST /api/v1/tx/broadcast', () => {
  it('broadcasts an EVM transaction and reports the hash', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);

    const { status, json } = await post(appWith(connector), '/api/v1/tx/broadcast', {
      network: 'ethereum',
      signedTx: SIGNED_EVM,
    });

    expect(status).toBe(200);
    expect(json.txHash).toBe(EVM_HASH);
    expect(json.network).toBe('ethereum');
    expect(typeof json.broadcastAt).toBe('number');
    expect(json.broadcastAt as number).toBeGreaterThan(1_700_000_000);
  });

  it('forwards the payload to the connector untouched', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);

    await post(appWith(connector), '/api/v1/tx/broadcast', {
      network: 'ethereum',
      signedTx: SIGNED_EVM,
    });

    expect(connector.broadcasted).toEqual([SIGNED_EVM]);
  });

  it('broadcasts a Solana transaction as base64', async () => {
    const connector = new FakeConnector('solana', SOL_HASH);

    const { status, json } = await post(appWith(connector), '/api/v1/tx/broadcast', {
      network: 'solana',
      signedTx: SIGNED_SOL,
    });

    expect(status).toBe(200);
    expect(json.txHash).toBe(SOL_HASH);
    expect(json.network).toBe('solana');
    expect(connector.broadcasted).toEqual([SIGNED_SOL]);
  });

  it('gives every broadcast its own hash', async () => {
    const first = new FakeConnector('ethereum', EVM_HASH);
    const second = new FakeConnector('ethereum', OTHER_EVM_HASH);

    const one = await post(appWith(first), '/api/v1/tx/broadcast', {
      network: 'ethereum',
      signedTx: SIGNED_EVM,
    });
    const two = await post(appWith(second), '/api/v1/tx/broadcast', {
      network: 'ethereum',
      signedTx: SIGNED_EVM,
    });

    expect(one.json.txHash).toBe(EVM_HASH);
    expect(two.json.txHash).toBe(OTHER_EVM_HASH);
    expect(one.json.txHash).not.toBe(two.json.txHash);
  });

  it('remembers the broadcast so a status call finds it', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);
    const app = appWith(connector);

    await post(app, '/api/v1/tx/broadcast', { network: 'ethereum', signedTx: SIGNED_EVM });
    const { status, json } = await get(app, `/api/v1/tx/ethereum/${EVM_HASH}/status`);

    expect(status).toBe(200);
    expect(json.status).toBe('pending');
    expect(json.txHash).toBe(EVM_HASH);
  });

  it('answers 400 INVALID_INPUT for an unknown network', async () => {
    const { status, json } = await post(
      appWith(new FakeConnector('ethereum', EVM_HASH)),
      '/api/v1/tx/broadcast',
      {
        network: 'dogecoin',
        signedTx: SIGNED_EVM,
      },
    );

    expect(status).toBe(400);
    expect(json.code).toBe('INVALID_INPUT');
  });

  it('answers 400 when the network is missing', async () => {
    const { status, json } = await post(
      appWith(new FakeConnector('ethereum', EVM_HASH)),
      '/api/v1/tx/broadcast',
      {
        signedTx: SIGNED_EVM,
      },
    );

    expect(status).toBe(400);
    expect(json.code).toBe('INVALID_INPUT');
  });

  it('answers 400 when the body is not an object', async () => {
    const app = appWith(new FakeConnector('ethereum', EVM_HASH));
    const response = await app.request('/api/v1/tx/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[1, 2, 3]',
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('INVALID_BODY');
  });

  it('answers 400 when signedTx is missing', async () => {
    const { status, json } = await post(
      appWith(new FakeConnector('ethereum', EVM_HASH)),
      '/api/v1/tx/broadcast',
      {
        network: 'ethereum',
      },
    );

    expect(status).toBe(400);
    expect(json.code).toBe('INVALID_INPUT');
  });

  it('answers 400 when an EVM payload is not hex', async () => {
    const { status, json } = await post(
      appWith(new FakeConnector('ethereum', EVM_HASH)),
      '/api/v1/tx/broadcast',
      {
        network: 'ethereum',
        signedTx: 'not-hex',
      },
    );

    expect(status).toBe(400);
    expect(json.code).toBe('INVALID_INPUT');
  });

  it('answers 503 BROADCAST_FAILED when the connector rejects the transaction', async () => {
    const connector = new FakeConnector('ethereum', EVM_HASH);
    connector.failure = new Error('nonce too low');

    const { status, json } = await post(appWith(connector), '/api/v1/tx/broadcast', {
      network: 'ethereum',
      signedTx: SIGNED_EVM,
    });

    expect(status).toBe(503);
    expect(json.code).toBe('BROADCAST_FAILED');
  });

  it('uses the real routes through the application factory', async () => {
    // The default factory is only exercised for its shape here: no payload is
    // ever sent, because an unknown network is rejected before it.
    const { status, json } = await post(createApp(), '/api/v1/tx/broadcast', {
      network: 'dogecoin',
      signedTx: SIGNED_EVM,
    });

    expect(status).toBe(400);
    expect(json.code).toBe('INVALID_INPUT');
  });
});

describe('GET /api/v1/tx/:network/:txHash/status', () => {
  it('reports a broadcast transaction with every field', async () => {
    const app = appWith(new FakeConnector('ethereum', EVM_HASH));
    await post(app, '/api/v1/tx/broadcast', { network: 'ethereum', signedTx: SIGNED_EVM });

    const { status, json } = await get(app, `/api/v1/tx/ethereum/${EVM_HASH}/status`);

    expect(status).toBe(200);
    expect(json.txHash).toBe(EVM_HASH);
    expect(json.network).toBe('ethereum');
    expect(json.status).toBe('pending');
    expect(json.confirmations).toBe(0);
    expect(typeof json.checkedAt).toBe('number');
    expect(json.checkedAt as number).toBeGreaterThan(1_700_000_000);
  });

  it('reports a Solana transaction', async () => {
    const app = appWith(new FakeConnector('solana', SOL_HASH));
    await post(app, '/api/v1/tx/broadcast', { network: 'solana', signedTx: SIGNED_SOL });

    const { status, json } = await get(app, `/api/v1/tx/solana/${SOL_HASH}/status`);

    expect(status).toBe(200);
    expect(json.network).toBe('solana');
    expect(json.status).toBe('pending');
    expect(json.confirmations).toBe(0);
  });

  it('reports a confirmed transaction from a connector that can read it', async () => {
    const connector = new ReadingConnector('ethereum', async () => ({
      status: 'confirmed',
      confirmations: 12,
    }));

    const { status, json } = await get(
      appWith(connector),
      `/api/v1/tx/ethereum/${EVM_HASH}/status`,
    );

    expect(status).toBe(200);
    expect(json.status).toBe('confirmed');
    expect(json.confirmations).toBe(12);
  });

  it('reports not_found for a transaction it never saw', async () => {
    const { status, json } = await get(
      appWith(new FakeConnector('ethereum', EVM_HASH)),
      `/api/v1/tx/ethereum/${OTHER_EVM_HASH}/status`,
    );

    expect(status).toBe(200);
    expect(json.status).toBe('not_found');
    expect(json.confirmations).toBe(0);
    expect(typeof json.checkedAt).toBe('number');
  });

  it('advances a tracked transaction to confirmed', async () => {
    const store = new TxStore();
    const app = appWith(new FakeConnector('ethereum', EVM_HASH), store);
    await post(app, '/api/v1/tx/broadcast', { network: 'ethereum', signedTx: SIGNED_EVM });
    store.mark('ethereum', EVM_HASH, 'confirmed', 7);

    const { json } = await get(app, `/api/v1/tx/ethereum/${EVM_HASH}/status`);

    expect(json.status).toBe('confirmed');
    expect(json.confirmations).toBe(7);
  });

  it('finds an EVM hash regardless of case', async () => {
    const app = appWith(new FakeConnector('ethereum', EVM_HASH));
    await post(app, '/api/v1/tx/broadcast', { network: 'ethereum', signedTx: SIGNED_EVM });

    // EIP-155 checksums are case sensitive on the wire but not in meaning.
    const upper = `0x${EVM_HASH.slice(2).toUpperCase()}`;
    const { status, json } = await get(app, `/api/v1/tx/ethereum/${upper}/status`);

    expect(status).toBe(200);
    expect(json.status).toBe('pending');
  });

  it('answers not_found through the application factory for an unknown hash', async () => {
    // The real ethereum connector is used here, and it makes no network call:
    // it has no read capability, so the answer comes from the local record.
    const { status, json } = await get(createApp(), `/api/v1/tx/ethereum/${OTHER_EVM_HASH}/status`);

    expect(status).toBe(200);
    expect(json.status).toBe('not_found');
    expect(json.confirmations).toBe(0);
  });

  it('answers 400 for a malformed hash', async () => {
    const { status, json } = await get(
      appWith(new FakeConnector('ethereum', EVM_HASH)),
      '/api/v1/tx/ethereum/not-a-hash/status',
    );

    expect(status).toBe(400);
    expect(json.code).toBe('INVALID_INPUT');
  });

  it('answers 400 for a hash that is too short', async () => {
    const { status, json } = await get(
      appWith(new FakeConnector('ethereum', EVM_HASH)),
      '/api/v1/tx/ethereum/0x1234/status',
    );

    expect(status).toBe(400);
    expect(json.code).toBe('INVALID_INPUT');
  });

  it('answers 400 for an unknown network', async () => {
    const { status, json } = await get(
      appWith(new FakeConnector('ethereum', EVM_HASH)),
      `/api/v1/tx/dogecoin/${TRON_HASH}/status`,
    );

    expect(status).toBe(400);
    expect(json.code).toBe('INVALID_INPUT');
  });

  it('answers 503 STATUS_FAILED when the connector cannot read', async () => {
    const connector = new ReadingConnector('ethereum', async () => {
      throw new Error('endpoint unreachable');
    });

    const { status, json } = await get(
      appWith(connector),
      `/api/v1/tx/ethereum/${EVM_HASH}/status`,
    );

    expect(status).toBe(503);
    expect(json.code).toBe('STATUS_FAILED');
  });
});

describe('tx record bookkeeping', () => {
  it('keys a transaction per network and normalises EVM hashes', () => {
    expect(txKey('ethereum', EVM_HASH)).toBe(`ethereum:${EVM_HASH}`);
    expect(txKey('ethereum', EVM_HASH.toUpperCase())).toBe(`ethereum:${EVM_HASH}`);
    expect(txKey('solana', SOL_HASH)).toBe(`solana:${SOL_HASH}`);
    expect(txKey('ethereum', OTHER_EVM_HASH)).not.toBe(txKey('solana', OTHER_SOL_HASH));
  });

  it('forgets every record on clear', async () => {
    const store = new TxStore();
    const app = appWith(new FakeConnector('ethereum', EVM_HASH), store);
    await post(app, '/api/v1/tx/broadcast', { network: 'ethereum', signedTx: SIGNED_EVM });
    store.clear();

    const { json } = await get(app, `/api/v1/tx/ethereum/${EVM_HASH}/status`);

    expect(json.status).toBe('not_found');
  });

  it('ignores a status update for an unknown transaction', () => {
    expect(() => new TxStore().mark('ethereum', EVM_HASH, 'confirmed', 3)).not.toThrow();
  });

  it("keeps two apps from seeing each other's broadcasts", async () => {
    const first = appWith(new FakeConnector('ethereum', EVM_HASH));
    const second = appWith(new FakeConnector('ethereum', EVM_HASH));

    await post(first, '/api/v1/tx/broadcast', { network: 'ethereum', signedTx: SIGNED_EVM });

    const mine = await get(first, `/api/v1/tx/ethereum/${EVM_HASH}/status`);
    const theirs = await get(second, `/api/v1/tx/ethereum/${EVM_HASH}/status`);

    expect(mine.json.status).toBe('pending');
    expect(theirs.json.status).toBe('not_found');
  });
});
