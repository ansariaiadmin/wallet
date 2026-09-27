import { AllRpcEndpointsFailedError, RpcError } from './errors';
import type { RetryOptions } from './types';

const DEFAULT_RETRY: Required<RetryOptions> = {
  attempts: 2,
  delayMs: 150,
  timeoutMs: 10_000,
};

/** Merges caller options with the defaults. */
export function resolveRetry(options?: RetryOptions): Required<RetryOptions> {
  return { ...DEFAULT_RETRY, ...options };
}

/** Sleeps for `ms`; injected in tests to keep them fast. */
export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `call` against each endpoint in order.
 *
 * Per endpoint: `attempts` tries with exponential backoff. When an endpoint is
 * exhausted the next one is tried, so a single dead node never fails a call.
 * Throws {@link AllRpcEndpointsFailedError} once every endpoint is exhausted.
 *
 * `stopOn` short-circuits the retry/fallback loop: when it returns true the
 * failure is rethrown as-is, because another endpoint would answer the same.
 */
export async function withFallback<T>(
  chainId: string,
  endpoints: readonly string[],
  call: (endpoint: string) => Promise<T>,
  options?: RetryOptions,
  sleep: Sleep = defaultSleep,
  stopOn?: (error: RpcError) => boolean,
): Promise<T> {
  const { attempts, delayMs, timeoutMs } = resolveRetry(options);
  const failures: RpcError[] = [];

  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await withTimeout(call(endpoint), timeoutMs, chainId, endpoint);
      } catch (error) {
        const rpcError =
          error instanceof RpcError
            ? error
            : new RpcError(chainId, endpoint, describeError(error), error);
        failures.push(rpcError);
        if (stopOn?.(rpcError) === true) {
          throw rpcError;
        }
        if (attempt < attempts) {
          await sleep(delayMs * 2 ** (attempt - 1));
        }
      }
    }
  }

  throw new AllRpcEndpointsFailedError(chainId, failures);
}

/**
 * True when the node answered the call with a JSON-RPC error object: the node
 * is reachable and evaluated the request, it simply rejected it. Retrying or
 * falling back would return the same verdict, so such failures are final.
 */
export function isNodeVerdict(error: RpcError): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    const candidate = current as { name?: unknown; details?: unknown };
    if (typeof candidate.details === 'string' && candidate.details.trim() !== '') return true;
    if (typeof candidate.name === 'string' && candidate.name.endsWith('RpcError')) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Best human readable reason for a failed RPC call: the message the node itself
 * provided (`details`) when available, otherwise the outermost error message.
 */
export function rpcReason(error: unknown): string {
  const chain: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }

  for (const item of chain) {
    const details = (item as { details?: unknown }).details;
    if (typeof details === 'string' && details.trim() !== '') return details;
  }
  for (const item of chain) {
    const message = (item as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return String(error);
}

/** POSTs JSON to `endpoint` and returns the decoded body. */
export async function postJson(
  chainId: string,
  endpoint: string,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const url = `${endpoint.replace(/\/+$/, '')}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new RpcError(chainId, endpoint, `request failed: ${describeError(error)}`, error);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new RpcError(chainId, endpoint, `HTTP ${response.status}: ${truncate(text)}`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new RpcError(chainId, endpoint, `invalid JSON response: ${truncate(text)}`, error);
  }
}

/** Rejects when `promise` takes longer than `timeoutMs`. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  chainId: string,
  endpoint: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new RpcError(chainId, endpoint, `timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function truncate(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
