/**
 * Local record of the transactions this process broadcast.
 *
 * The P3 connectors can broadcast but cannot read a transaction back: none of
 * them exposes a status method, and adding one would mean live RPC reads this
 * phase forbids. The facade therefore keeps its own record — a broadcast is
 * `pending` until a chain-read poller (or a test) advances it — and answers
 * `not_found` for anything it never saw.
 *
 * When a connector *does* implement `getTransactionStatus`, that capability is
 * preferred, so the same code path serves a chain that can read state.
 */

import type { ChainConnector } from '@wallet/chains';
import { NETWORK_FAMILY, type NetworkId } from './networks';

/** Lifecycle states a tracked transaction can be in. */
export type TrackedStatus = 'pending' | 'confirmed' | 'failed';

/** What the facade knows about one broadcast transaction. */
export interface TxRecord {
  readonly status: TrackedStatus;
  readonly confirmations: number;
  /** When the transaction was broadcast, in ms. */
  readonly broadcastAt: number;
}

/** Stable key for one transaction on one network. */
export function txKey(network: NetworkId, txHash: string): string {
  const hash = txHash.trim();
  const normalized = NETWORK_FAMILY[network] === 'evm' ? hash.toLowerCase() : hash;
  return `${network}:${normalized}`;
}

/**
 * The transactions one application broadcast, keyed by `network:txHash`.
 *
 * This used to be a module-level map, which meant two apps built in the same
 * process shared one transaction history: a broadcast through one app was
 * visible to the other, and a test that reset the map reset it for every other
 * test. One instance per app, passed in the same way as the logout list, is
 * what keeps them independent.
 */
export class TxStore {
  private readonly records = new Map<string, TxRecord>();

  /** Remembers a fresh broadcast as `pending` with no confirmations yet. */
  record(network: NetworkId, txHash: string, broadcastAt: number): void {
    this.records.set(txKey(network, txHash), { status: 'pending', confirmations: 0, broadcastAt });
  }

  /** Advances a tracked transaction, e.g. after a chain-read poll. */
  mark(network: NetworkId, txHash: string, status: TrackedStatus, confirmations: number): void {
    const key = txKey(network, txHash);
    const existing = this.records.get(key);
    if (existing === undefined) {
      return;
    }
    this.records.set(key, { status, confirmations, broadcastAt: existing.broadcastAt });
  }

  /** The tracked record for one transaction, if this app broadcast it. */
  lookup(network: NetworkId, txHash: string): TxRecord | undefined {
    return this.records.get(txKey(network, txHash));
  }

  /** Drops every record this store holds. */
  clear(): void {
    this.records.clear();
  }

  /** How many transactions this store tracks. */
  get size(): number {
    return this.records.size;
  }
}

/** Optional connector capability: read a transaction back from the chain. */
interface TransactionReader {
  getTransactionStatus(txHash: string): Promise<TxRecord | undefined>;
}

/**
 * Reads the status of `txHash`, preferring the connector's own capability when
 * it has one and falling back to the local record otherwise.
 *
 * @throws whatever the connector throws, which the caller maps onto 503.
 */
export async function readTransactionStatus(
  connector: ChainConnector,
  store: TxStore,
  network: NetworkId,
  txHash: string,
): Promise<TxRecord | undefined> {
  const candidate = connector as unknown as Partial<TransactionReader>;
  if (typeof candidate.getTransactionStatus === 'function') {
    return candidate.getTransactionStatus(txHash);
  }
  return store.lookup(network, txHash);
}
