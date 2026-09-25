import { describe, expect, it } from 'vitest';
import { WalletApp } from '@api/app';

describe('WalletApp', () => {
  it('tops up a wallet and reads the balance back', async () => {
    const app = new WalletApp();

    await app.execute({ op: 'topup', walletId: 'w1', amountMinor: 1000n });
    const result = await app.execute({ op: 'balance', walletId: 'w1' });

    expect(result).toEqual({ ok: true, balanceMinor: 1000n });
  });

  it('deducts when funds are sufficient', async () => {
    const app = new WalletApp();
    await app.execute({ op: 'topup', walletId: 'w1', amountMinor: 1000n });

    const result = await app.execute({ op: 'deduct', walletId: 'w1', amountMinor: 400n });

    expect(result).toEqual({ ok: true, balanceMinor: 600n });
  });

  it('refuses to overdraw a wallet', async () => {
    const app = new WalletApp();
    await app.execute({ op: 'topup', walletId: 'w1', amountMinor: 100n });

    const result = await app.execute({ op: 'deduct', walletId: 'w1', amountMinor: 500n });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('insufficient_funds');
    expect(result.balanceMinor).toBe(100n);
  });

  it('keeps a posting history per wallet', async () => {
    const app = new WalletApp();
    await app.execute({ op: 'topup', walletId: 'w1', amountMinor: 1000n });
    await app.execute({ op: 'deduct', walletId: 'w1', amountMinor: 250n });

    const history = app.history('w1');

    expect(history).toHaveLength(2);
    expect(history[0]?.direction).toBe('debit');
    expect(history[0]?.money.amountMinor).toBe(250n);
    expect(history[1]?.direction).toBe('credit');
    expect(app.history('other')).toHaveLength(0);
  });
});
