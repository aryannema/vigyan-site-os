import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level tests: functional, UI/UX, and branding.
 *
 * Separate from `pnpm test` (unit) and `pnpm test:db` (Postgres) because this
 * layer needs a running site, which the others do not. Three commands, three
 * dependencies, so a failure tells you which layer broke.
 *
 * PORT matters more than it looks: a dev server for the MAIN checkout already
 * runs on 3000 on this machine, so a suite pointed at 3000 silently tests a
 * different branch. That happened during development — an agent verified a fix
 * against code that did not contain it. Hence the explicit, non-default port
 * and a webServer block that starts THIS working tree.
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // A UI regression is rarely flaky; a retry that goes green usually means the
  // test races the page rather than that the bug is intermittent. One retry in
  // CI only, to absorb cold-start noise.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Only start a server when pointing at the default local port. An explicit
  // E2E_BASE_URL means the operator is aiming at something already running
  // (a preview deploy, staging) and Playwright must not try to boot one.
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: `pnpm dev -p ${PORT}`,
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
