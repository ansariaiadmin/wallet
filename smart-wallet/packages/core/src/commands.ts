/** A command accepted by the wallet API surface. */
export interface Command {
  readonly op: 'topup' | 'deduct' | 'balance';
  readonly walletId: string;
  readonly amountMinor?: bigint;
}

/** The outcome of executing a {@link Command}. */
export interface CommandResult {
  readonly ok: boolean;
  readonly balanceMinor: bigint;
  readonly error?: string;
}
