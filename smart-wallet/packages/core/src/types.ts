import type { Money } from './money';

/** Which side of a double-entry posting an amount lands on. */
export type LedgerDirection = 'debit' | 'credit';

/** A single immutable posting in the wallet ledger. */
export interface LedgerPosting {
  readonly id: string;
  readonly walletId: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly description: string;
  readonly createdAt: string;
}
