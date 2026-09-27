/**
 * The workspace-wide vitest defaults, as plain data.
 *
 * Deliberately import-free: this file sits at the workspace root, outside every
 * package, so it cannot resolve `vitest/config` under pnpm's strict
 * `node_modules`. Each package spreads these values into its own
 * `defineConfig`, which is where the types are checked.
 *
 * Two settings exist because CI proved they are needed, not because they look
 * tidy:
 *
 * - A bounded fork pool. Unbounded, vitest spawned one worker per package on a
 *   two-core runner and the suite failed intermittently — the same code passed
 *   on a retry and on a developer machine. A green run has to mean green.
 * - `pool: 'forks'` so a test that opens a real socket cannot leave shared
 *   state behind for the next file in a thread pool.
 * - `retry: 0`: a test that fails once and passes on a retry is a race, and CI
 *   must not be able to hide one.
 */
export const sharedTestConfig = {
  environment: 'node',
  pool: 'forks',
  poolOptions: {
    forks: {
      maxForks: 2,
      minForks: 1,
      singleFork: false,
    },
  },
  testTimeout: 20_000,
  hookTimeout: 20_000,
  retry: 0,
} as const;
