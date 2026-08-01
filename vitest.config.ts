import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@data': fileURLToPath(new URL('./data', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ["tests/**/*.test.ts"],
    // Keeps the worker's progress RPC alive between CPU-bound cases - see the
    // comment in tests/setup.ts.
    setupFiles: ['./tests/setup.ts'],
    // These suites simulate tens of thousands of races.
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
