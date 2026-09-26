import { Hono } from 'hono';
import { createConnector, type ChainConnector } from '@wallet/chains';
import { ApiError } from '../errors';
import { isTxHash, toBroadcastPayload } from '../broadcast';
import { NETWORK_CHAIN_ID, isNetworkId, networkFlag, type NetworkId } from '../networks';
import { readJsonObject } from '../request';
import { isNonEmptyString } from '../validation';
import { readTransactionStatus, recordBroadcast, type TxRecord } from '../tx-status';

/** Dependencies a test can replace; production uses the real connectors. */
export interface BroadcastDeps {
  /** Builds the connector for a network. Defaults to the P3 registry. */
  readonly connector?: (network: NetworkId) => ChainConnector;
  /** Clock in ms. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Broadcasts an already-signed transaction.
 *
 * The route only forwards what it is given: it never signs, never derives keys
 * and never holds key material. A payload that does not match the family's
 * encoding is a 400; anything the connector rejects is a 503.
 */
export function broadcastRoutes(deps: BroadcastDeps = {}): Hono {
  return new Hono().post('/tx/broadcast', async (c) => {
    const body = await readJsonObject(c);

    const network = body.network;
    if (!isNetworkId(network)) {
      throw new ApiError(400, 'INVALID_INPUT', 'network must be a supported network id');
    }

    const signedTx = body.signedTx;
    if (!isNonEmptyString(signedTx)) {
      throw new ApiError(
        400,
        'INVALID_INPUT',
        'signedTx is required and must be a non-empty string',
      );
    }

    const payload = toBroadcastPayload(network, signedTx);
    const connector = resolveConnector(deps, network);

    let txHash: string;
    try {
      txHash = (await connector.broadcast(payload)).txHash;
    } catch (error) {
      throw new ApiError(503, 'BROADCAST_FAILED', reason(error));
    }

    const broadcastAt = now(deps)();
    // Remembered so a later status call can report it without a chain read.
    recordBroadcast(network, txHash, broadcastAt);
    return c.json({ txHash, network, broadcastAt }, 200);
  });
}

/**
 * Reports the status of a transaction.
 *
 * With the shipped connectors the answer comes from this process's own record
 * of what it broadcast (`pending`, or `not_found` for an unknown hash); a
 * connector that can read transactions answers instead, and a connector that
 * fails becomes a 503.
 */
export function statusRoutes(deps: BroadcastDeps = {}): Hono {
  return new Hono().get('/tx/:network/:txHash/status', async (c) => {
    const network = c.req.param('network');
    if (!isNetworkId(network)) {
      throw new ApiError(400, 'INVALID_INPUT', 'network must be a supported network id');
    }
    const txHash = c.req.param('txHash') ?? '';
    if (!isTxHash(network, txHash)) {
      throw new ApiError(400, 'INVALID_INPUT', `txHash is not a valid ${network} transaction hash`);
    }

    const connector = resolveConnector(deps, network);
    let record: TxRecord | undefined;
    try {
      record = await readTransactionStatus(connector, network, txHash);
    } catch (error) {
      throw new ApiError(503, 'STATUS_FAILED', reason(error));
    }

    const checkedAt = now(deps)();
    if (record === undefined) {
      return c.json({ txHash, network, status: 'not_found', confirmations: 0, checkedAt }, 200);
    }
    return c.json(
      { txHash, network, status: record.status, confirmations: record.confirmations, checkedAt },
      200,
    );
  });
}

/** The connector for `network`, from the injected factory or the registry. */
function resolveConnector(deps: BroadcastDeps, network: NetworkId): ChainConnector {
  if (deps.connector !== undefined) {
    return deps.connector(network);
  }
  return createConnector(NETWORK_CHAIN_ID[network], { network: networkFlag(network) });
}

/** The clock, injected or real. */
function now(deps: BroadcastDeps): () => number {
  return deps.now ?? Date.now;
}

/** Message for a 503 answer: what the connector said, never a stack trace. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'connector failure';
}
