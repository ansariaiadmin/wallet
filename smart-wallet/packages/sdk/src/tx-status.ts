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
import { NETWORK_FAMILY } from './networks';
import type { NetworkId } from './types';

/** Lifecycle states a tracked transaction can be in. */
export type TrackedStatus = 'pending' | 'confirmed' | 'failed';

/** What the facade knows about one broadcast transaction. */
export interface TxRecord {
  readonly status: TrackedStatus;
  readonly confirmations: number;
  /** When the transaction was broadcast, in ms. */
  readonly broadcastAt: number;
}

/** Records keyed by `network:txHash`; EVM hashes are case-insensitive. */
const records = new Map<string, TxRecord>();

/** Stable key for one transaction on one network. */
export function txKey(network: NetworkId, txHash: string): string {
  const hash = txHash.trim();
  const normalized = NETWORK_FAMILY[network] === 'evm' ? hash.toLowerCase() : hash;
  return `${network}:${normalized}`;
}

/** Remembers a fresh broadcast as `pending` with no confirmations yet. */
export function recordBroadcast(network: NetworkId, txHash: string, broadcastAt: number): void {
  records.set(txKey(network, txHash), { status: 'pending', confirmations: 0, broadcastAt });
}

/** Advances a tracked transaction, e.g. after a chain-read poll. */
export function markTxStatus(
  network: NetworkId,
  txHash: string,
  status: TrackedStatus,
  confirmations: number,
): void {
  const key = txKey(network, txHash);
  const existing = records.get(key);
  if (existing === undefined) {
    return;
  }
  records.set(key, { status, confirmations, broadcastAt: existing.broadcastAt });
}

/** The tracked record for one transaction, if this process broadcast it. */
export function lookupTx(network: NetworkId, txHash: string): TxRecord | undefined {
  return records.get(txKey(network, txHash));
}

/** Drops every record. Only used by tests to keep them independent. */
export function resetTxRecords(): void {
  records.clear();
}

/** Optional connector capability: read a transaction back from the chain. */
interface TransactionReader {
  getTransactionStatus(txHash: string): Promise<TxRecord | undefined>;
}

/**
 * Reads the status of `txHash`, preferring the connector's own capability when
 * it has one and falling back to the local record otherwise.
 *
 * @throws whatever the connector throws, which the caller maps onto an
 *   `SdkError('STATUS_FAILED')`.
 */
export async function readTransactionStatus(
  connector: ChainConnector,
  network: NetworkId,
  txHash: string,
): Promise<TxRecord | undefined> {
  const candidate = connector as unknown as Partial<TransactionReader>;
  if (typeof candidate.getTransactionStatus === 'function') {
    return candidate.getTransactionStatus(txHash);
  }
  return lookupTx(network, txHash);
}
