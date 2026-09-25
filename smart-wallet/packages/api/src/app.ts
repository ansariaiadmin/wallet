import type { Command, CommandResult } from '@core/commands';
import type { LedgerDirection, LedgerPosting } from '@core/types';
import { add, compare, money, subtract, type Money } from '@core/money';
import { Router } from '@router/router';

interface Ctx {
  readonly command: Command;
}

/**
 * In-memory wallet surface: keeps per-wallet balances plus a posting history and
 * exposes them through a {@link Router} keyed by command name.
 */
export class WalletApp {
  private readonly balances = new Map<string, Money>();
  private readonly postings: LedgerPosting[] = [];
  private readonly router = new Router<Ctx>();
  private sequence = 0;

  constructor() {
    this.router
      .register('topup', ({ command }) => this.apply(command, 'credit'))
      .register('deduct', ({ command }) => this.apply(command, 'debit'))
      .register('balance', ({ command }) => ({
        ok: true,
        balanceMinor: this.balanceOf(command.walletId).amountMinor,
      }));
  }

  /** Executes a command and returns the resulting balance snapshot. */
  async execute(command: Command): Promise<CommandResult> {
    return this.router.dispatch<CommandResult>(command.op, { command });
  }

  /** Posting history for a wallet, newest first. */
  history(walletId: string): readonly LedgerPosting[] {
    return this.postings.filter((posting) => posting.walletId === walletId).reverse();
  }

  private balanceOf(walletId: string): Money {
    return this.balances.get(walletId) ?? money(0n);
  }

  private apply(command: Command, direction: LedgerDirection): CommandResult {
    const walletId = command.walletId;
    const amount = money(command.amountMinor ?? 0n);
    const current = this.balanceOf(walletId);

    if (direction === 'debit' && compare(current, amount) < 0) {
      return { ok: false, balanceMinor: current.amountMinor, error: 'insufficient_funds' };
    }

    const next = direction === 'credit' ? add(current, amount) : subtract(current, amount);

    this.balances.set(walletId, next);
    this.postings.push({
      id: this.nextId('posting'),
      walletId,
      direction,
      money: amount,
      description: command.op,
      createdAt: new Date().toISOString(),
    });

    return { ok: true, balanceMinor: next.amountMinor };
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString().padStart(6, '0')}`;
  }
}
