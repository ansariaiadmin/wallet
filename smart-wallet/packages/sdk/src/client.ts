import type { Command, CommandResult } from '@core/commands';

/** Anything that can deliver a {@link Command} and return its {@link CommandResult}. */
export interface Transport {
  send(command: Command): Promise<CommandResult>;
}

/** Typed client for the wallet API surface. */
export class WalletClient {
  constructor(private readonly transport: Transport) {}

  /** Tops a wallet up by `amountMinor` minor units. */
  topup(walletId: string, amountMinor: bigint): Promise<CommandResult> {
    return this.transport.send({ op: 'topup', walletId, amountMinor });
  }

  /** Deducts `amountMinor` minor units from a wallet. */
  deduct(walletId: string, amountMinor: bigint): Promise<CommandResult> {
    return this.transport.send({ op: 'deduct', walletId, amountMinor });
  }

  /** Reads the current balance of a wallet. */
  balance(walletId: string): Promise<CommandResult> {
    return this.transport.send({ op: 'balance', walletId });
  }
}
