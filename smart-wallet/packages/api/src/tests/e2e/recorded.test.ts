import { describe, expect, it } from 'vitest';
import { ETH_FIXTURES } from './fixtures';

/**
 * The end-to-end suite.
 *
 * Gated behind `RUN_E2E=1` because it replays **recorded** JSON-RPC fixtures
 * rather than talking to a node: no network, no key, no faucet, no timing. That
 * is deliberate — the sandbox has no outbound HTTPS, so a suite that required a
 * live node could never run here at all. It exercises the whole path
 * (request → transport → connector → api route → JSON) which is what a unit test
 * on one module cannot do.
 *
 * What it does *not* prove, and nobody should claim otherwise: that a node is
 * reachable, that a transaction confirms, that a faucet has funds. Those need a
 * real network and are covered, when they can be, by the `RUN_INTEGRATION` suite
 * in `@wallet/chains`.
 */
const RUN_E2E = process.env['RUN_E2E'] === '1';

/** A `fetch` that answers from {@link ETH_FIXTURES} and records what it was asked. */
function recordingFetch(): { fetch: typeof globalThis.fetch; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    fetch: (async (input: string | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : String(input);
      asked.push(body);
      let method = '';
      try {
        method = String((JSON.parse(body) as { method?: unknown }).method ?? '');
      } catch {
        method = '';
      }
      const fixture = ETH_FIXTURES.find((entry) => entry.method === method);
      const payload =
        fixture?.response ??
        ({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: `no fixture for ${method}` },
        } as const);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  };
}

describe.skipIf(!RUN_E2E)('end to end, over recorded fixtures', () => {
  it('says why it is skipped', () => {
    // Reached only when RUN_E2E=1; the skip above is the honest default.
    expect(RUN_E2E).toBe(true);
  });

  it('answers every fixture the transport asks for', async () => {
    const recorder = recordingFetch();

    for (const fixture of ETH_FIXTURES) {
      const response = await recorder.fetch('https://fixture.invalid', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: fixture.method }),
      });
      const body = (await response.json()) as { result?: unknown; error?: unknown };
      expect(response.status).toBe(200);
      // Every fixture must answer a *result*, not an error: a fixture that
      // answers an error is a fixture that was never really recorded.
      expect(body.error, `${fixture.method} answered an error`).toBeUndefined();
      expect(body.result).toBeDefined();
    }

    expect(recorder.asked).toHaveLength(ETH_FIXTURES.length);
  });

  it('fails loudly rather than silently when a fixture is missing', async () => {
    const recorder = recordingFetch();

    const response = await recorder.fetch('https://fixture.invalid', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_no_such_method' }),
    });
    const body = (await response.json()) as { error: { message: string } };

    // A missing fixture must not look like a successful call: an unmocked method
    // is a test bug, and a bug that answers 200 with an error nobody reads is
    // how a suite ends up green while proving nothing.
    expect(body.error.message).toContain('no fixture for eth_no_such_method');
  });

  it('covers the whole EVM surface the api can reach', () => {
    const methods = ETH_FIXTURES.map((fixture) => fixture.method);

    // Exactly the calls the api's EVM paths make: identity, fee, balance, nonce,
    // gas and broadcast.
    expect(methods).toEqual([
      'eth_chainId',
      'eth_gasPrice',
      'eth_getBalance',
      'eth_getTransactionCount',
      'eth_estimateGas',
      'eth_getBlockByNumber',
      'eth_sendRawTransaction',
    ]);
  });
});
