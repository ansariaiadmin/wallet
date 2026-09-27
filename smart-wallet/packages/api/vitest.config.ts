import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromHere = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@wallet/chains': fromHere('../chains/src'),
      '@wallet/keys': fromHere('../keys/src'),
      '@keys': fromHere('../keys/src'),
      '@core': fromHere('../core/src'),
      '@chains': fromHere('../chains/src'),
      '@router': fromHere('../router/src'),
      '@api': fromHere('../api/src'),
      '@sdk': fromHere('../sdk/src'),
    },
  },
});
