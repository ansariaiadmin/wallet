import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromHere = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@keys': fromHere('../keys/src'),
    },
  },
});
