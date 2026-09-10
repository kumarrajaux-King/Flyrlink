import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['tests/setup.ts'],
    // The Docker-less development PostgreSQL (scripts/pglite-server.mjs) accepts
    // one connection at a time, so integration suites must not run in parallel
    // against it. The whole suite is fast enough that this costs little.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
