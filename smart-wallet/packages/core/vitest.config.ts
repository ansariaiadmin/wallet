import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

const fromHere = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  test: {
    ...sharedTestConfig,
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@core': fromHere('../core/src'),
      '@router': fromHere('../router/src'),
      '@api': fromHere('../api/src'),
      '@sdk': fromHere('../sdk/src'),
      '@chains': fromHere('../chains/src'),
    },
  },
});
