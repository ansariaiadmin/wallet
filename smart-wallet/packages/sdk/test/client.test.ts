import { describe, expect, it } from 'vitest';
import type { Command, CommandResult } from '@core/commands';
import { WalletClient, type Transport } from '@sdk/client';

function fakeTransport(reply: CommandResult): { transport: Transport; sent: Command[] } {
  const sent: Command[] = [];
  return {
    sent,
    transport: {
      send: async (command: Command) => {
        sent.push(command);
        return reply;
      },
    },
  };
}

describe('WalletClient', () => {
  it('sends topup commands through the transport', async () => {
    const { transport, sent } = fakeTransport({ ok: true, balanceMinor: 1500n });
    const client = new WalletClient(transport);

    const result = await client.topup('w1', 1500n);

    expect(result.balanceMinor).toBe(1500n);
    expect(sent).toEqual([{ op: 'topup', walletId: 'w1', amountMinor: 1500n }]);
  });

  it('reads balances', async () => {
    const { transport, sent } = fakeTransport({ ok: true, balanceMinor: 42n });
    const client = new WalletClient(transport);

    const result = await client.balance('w1');

    expect(result.ok).toBe(true);
    expect(sent).toEqual([{ op: 'balance', walletId: 'w1' }]);
  });

  it('propagates failed deductions', async () => {
    const { transport } = fakeTransport({
      ok: false,
      balanceMinor: 0n,
      error: 'insufficient_funds',
    });
    const client = new WalletClient(transport);

    const result = await client.deduct('w1', 10n);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('insufficient_funds');
  });
});
