import { createServer, type Server } from 'node:http';

/** A canned HTTP response from a mock node. */
export interface MockResponse {
  readonly status?: number;
  readonly body: unknown;
}

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

export interface MockServer {
  readonly url: string;
  readonly requests: readonly RecordedRequest[];
  close(): Promise<void>;
}

/**
 * Starts a local HTTP server that answers every request through `handler`.
 * Handler exceptions become HTTP 500s, which is how dead nodes behave.
 */
export async function startMockServer(
  handler: (path: string, body: unknown) => MockResponse,
): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = raw;
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = raw;
      }
      requests.push({ method: req.method ?? 'POST', path: req.url ?? '/', body });

      let response: MockResponse;
      try {
        response = handler(req.url ?? '/', body);
      } catch (error) {
        response = { status: 500, body: { error: (error as Error).message } };
      }
      res.writeHead(response.status ?? 200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(response.body, (_key, value) =>
          typeof value === 'bigint' ? Number(value) : value,
        ),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface JsonRpcRequest {
  readonly id: number;
  readonly method: string;
  readonly params: unknown[];
}

/** Throw this from a responder to answer with a JSON-RPC error (HTTP 200). */
export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wraps a method handler into a JSON-RPC mock (single and batched requests). */
export function jsonRpcHandler(
  respond: (method: string, params: unknown[]) => unknown,
): (path: string, body: unknown) => MockResponse {
  const answer = (request: JsonRpcRequest) => {
    try {
      return { jsonrpc: '2.0', id: request.id, result: respond(request.method, request.params) };
    } catch (error) {
      if (error instanceof JsonRpcError) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: error.code, message: error.message },
        };
      }
      throw error;
    }
  };

  return (_path, body) => {
    if (Array.isArray(body)) {
      return { body: (body as JsonRpcRequest[]).map(answer) };
    }
    return { body: answer(body as JsonRpcRequest) };
  };
}

/** A mock node that is always down (HTTP 500). */
export const deadNode = (): ((path: string, body: unknown) => MockResponse) => () => ({
  status: 500,
  body: { error: 'node unavailable' },
});
