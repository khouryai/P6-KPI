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
    // The application's own static server, not `vite preview`. It binds 127.0.0.1
    // explicitly, so there is no question of the server listening on ::1 while the
    // tests knock on 127.0.0.1, and it loads no vite config and spawns no npx — the
    // three things that can leave a preview server silently never answering.
    command: 'node server/serve.mjs 4173',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Without these the server's output is discarded, so a server that refuses to
    // start reads in CI as a bare timeout with no cause. That is what happened.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
