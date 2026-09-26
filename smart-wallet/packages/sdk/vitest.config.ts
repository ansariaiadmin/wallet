import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromHere = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@wallet/core': fromHere('../core/src/index.ts'),
      '@wallet/chains': fromHere('../chains/src/index.ts'),
      '@wallet/router': fromHere('../router/src/index.ts'),
      '@wallet/keys': fromHere('../keys/src/index.ts'),
      '@keys': fromHere('../keys/src'),
      '@core': fromHere('../core/src'),
      '@chains': fromHere('../chains/src'),
      '@router': fromHere('../router/src'),
      '@api': fromHere('../api/src'),
      '@sdk': fromHere('../sdk/src'),
    },
  },
});
