import { Hono } from 'hono';

/** Liveness probe: no dependency, no I/O. */
export function healthRoutes(): Hono {
  return new Hono().get('/health', (c) =>
    c.json({ status: 'ok', ts: Math.floor(Date.now() / 1000) }, 200),
  );
}
