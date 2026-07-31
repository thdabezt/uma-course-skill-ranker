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
    // These suites simulate tens of thousands of races.
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
