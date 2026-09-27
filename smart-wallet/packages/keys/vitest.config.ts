import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

const fromHere = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  test: {
    ...sharedTestConfig,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@keys': fromHere('../keys/src'),
    },
  },
});
