import { defineConfig } from '@playwright/test';

/**
 * The browser tests.
 *
 * Kept apart from `npm test`, which is the engine and runs in a second with no
 * browser. These need a built application and a server, so they are their own
 * command: `npm run test:ui`.
 *
 * They exist because every screen in this application has been smoke-tested by
 * hand after every change, and a check somebody has to remember to run is a check
 * that eventually does not get run.
 */
export default defineConfig({
  testDir: 'tests-ui',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined },
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
