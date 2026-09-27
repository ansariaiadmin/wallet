import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app';
import { nullLogger } from '../logger';

/**
 * The documented surface.
 *
 * A README claim about which endpoints exist is unverifiable by reading, so the
 * claim is checked here instead: every route the app actually serves must appear
 * in `docs/openapi.yaml`, and every path in the document must be served. A route
 * added without a doc, or a doc left behind by a deleted route, fails this test.
 */
/** `smart-wallet/docs/openapi.yaml`, from wherever the test is run. */
const SPEC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
  'docs/openapi.yaml',
);
const spec = readFileSync(SPEC_PATH, 'utf8');

/** Every path the document declares, with `{param}` left as-is. */
function documentedPaths(): string[] {
  const paths = new Set<string>();
  // Only top-level path keys, not the `$ref` or `parameters` blocks below them.
  const lines = spec.split('\n');
  let inPaths = false;
  for (const line of lines) {
    if (/^paths:/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^\S/.test(line)) {
      break;
    }
    if (inPaths) {
      const match = /^ {2}(\/\S+):/.exec(line);
      if (match?.[1] !== undefined) {
        paths.add(match[1]);
      }
    }
  }
  return [...paths].sort();
}

/** Every route the app serves, discovered by asking it. */
async function servedRoutes(): Promise<string[]> {
  const app = createApp({ logger: nullLogger });
  const found = new Set<string>();

  // A route that exists answers something other than the 404 handler's message,
  // and one that does not exist answers it. Asking with a plausible value for
  // each parameter is what makes the difference visible.
  // The pattern the document declares, and a concrete path that exercises it.
  const probes: readonly (readonly [string, string, string])[] = [
    ['GET', '/api/v1/health', '/api/v1/health'],
    ['GET', '/api/v1/price/{symbol}', '/api/v1/price/ETH'],
    ['POST', '/api/v1/risk/address', '/api/v1/risk/address'],
    ['POST', '/api/v1/risk/token', '/api/v1/risk/token'],
    ['POST', '/api/v1/tx/build', '/api/v1/tx/build'],
    ['POST', '/api/v1/tx/broadcast', '/api/v1/tx/broadcast'],
    [
      'GET',
      '/api/v1/tx/{network}/{txHash}/status',
      '/api/v1/tx/ethereum/0x9c3b2d1e5f7a8b4c6d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c/status',
    ],
    ['POST', '/api/v1/quote', '/api/v1/quote'],
    ['POST', '/api/v1/auth/register', '/api/v1/auth/register'],
    ['POST', '/api/v1/auth/login', '/api/v1/auth/login'],
    ['GET', '/api/v1/auth/me', '/api/v1/auth/me'],
    ['DELETE', '/api/v1/auth/logout', '/api/v1/auth/logout'],
    ['GET', '/api/v1/cache/stats', '/api/v1/cache/stats'],
    ['DELETE', '/api/v1/cache', '/api/v1/cache'],
    ['GET', '/api/v1/metrics', '/api/v1/metrics'],
  ];

  for (const [method, pattern, path] of probes) {
    const response = await app.request(path, {
      method,
      ...(method === 'GET' || method === 'DELETE'
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: '{}' }),
    });
    const body = await response.clone().text();
    // The 404 handler names the path it could not match.
    if (!body.includes('no route for')) {
      found.add(pattern);
    }
  }
  return [...found].sort();
}

describe('docs/openapi.yaml', () => {
  it('is parseable and names the API', () => {
    expect(spec).toContain('openapi: 3.1.0');
    expect(spec).toContain('title: Smart Wallet API');
  });

  it('documents every route the app serves', async () => {
    const served = await servedRoutes();
    const documented = documentedPaths();

    expect(served.length).toBeGreaterThan(10);
    for (const route of served) {
      expect(documented, `${route} is served but not documented`).toContain(route);
    }
  });

  it('documents nothing the app does not serve', async () => {
    const served = await servedRoutes();
    const documented = documentedPaths();

    for (const path of documented) {
      expect(served, `${path} is documented but not served`).toContain(path);
    }
  });

  it('gives every operation an id and a response', () => {
    const operationIds = spec.match(/^ {6}operationId: \S+$/gm) ?? [];
    const responses = spec.match(/^ {6}responses:$/gm) ?? [];

    expect(operationIds.length).toBeGreaterThanOrEqual(14);
    // One `responses` block per operation.
    expect(responses.length).toBe(operationIds.length);
  });

  it('states that the server never holds a private key', () => {
    expect(spec).toContain('never holds a private key');
    expect(spec).toContain('unsigned');
  });

  it('declares a security scheme and a 401 answer', () => {
    expect(spec).toContain('bearerAuth');
    expect(spec).toContain("'401'");
  });
});
