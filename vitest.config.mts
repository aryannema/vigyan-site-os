import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // tsconfig.json sets `"jsx": "preserve"` (Next compiles JSX itself), which
  // Vite honours — leaving raw JSX in the module it then tries to parse as
  // plain JS. Tests need it actually transformed, so the runtime is forced here.
  // Vitest 4 runs on Vite 8/Rolldown, where this option is `oxc`, not `esbuild`.
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  resolve: {
    // Mirrors tsconfig.json's `@/*` -> `./src/*` so test files can use the same
    // import specifiers as application code.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Only the content library has tests today; the rest of the app is covered
    // by `pnpm typecheck` and `pnpm build`.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
