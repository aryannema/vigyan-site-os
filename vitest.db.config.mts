import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Database integration tests — separate from `pnpm test` on purpose.
 *
 * These need a real Postgres with every migration applied, so folding them into
 * the default run would mean `pnpm test` fails on any machine without a
 * database. The unit tests under src/ stay runnable anywhere; this config is
 * what `pnpm test:db` uses.
 *
 * Each file opens ONE connection and runs inside a single transaction that is
 * rolled back at the end, so a run leaves no rows behind. That also means the
 * files must not run in parallel against the same database: `SET ROLE` and the
 * session identity are connection-wide, and two files interleaving would see
 * each other's role changes.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // One file at a time: role and session state live on the connection.
    fileParallelism: false,
    // A migration-heavy schema takes a moment to reach on first connect.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
