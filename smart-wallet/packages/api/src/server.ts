import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { createApp, type AppDeps } from './app';
import { applyConfig, configFromEnv, type ApiConfig } from './config';

/**
 * Builds the app from `config` and starts listening.
 *
 * This is the production entry point: `configFromEnv()` reads the process
 * environment, `applyConfig` fills only the dependencies the caller left unset
 * (so an embedder can still inject its own stores), and `serve` binds the
 * socket. Nothing here reads a config file and no secret is ever logged.
 */
export function startServer(deps: AppDeps = {}, config: ApiConfig = configFromEnv()): ServerType {
  const app = createApp(applyConfig(deps, config));
  return serve({ fetch: app.fetch, port: config.port });
}

/** Runs the server when this file is the process entry point. */
function main(): void {
  const config = configFromEnv();
  const server = startServer({}, config);
  const shutdown = (signal: string): void => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  // The port is not a secret; the signing secret never appears in a log line.
  console.log(`wallet api listening on port ${config.port}`);
}

// Only auto-starts when executed directly, never when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
