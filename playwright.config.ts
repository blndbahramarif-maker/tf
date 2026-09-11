import { defineConfig, devices } from '@playwright/test';
import { e2eDatabaseUrl } from './e2e/database';

/**
 * End-to-end configuration.
 *
 * These tests drive a REAL browser against a REAL production build talking to
 * a REAL database. Nothing is mocked — that is the whole point. The unit and
 * API suites already prove the pieces; this proves the browser can actually
 * hold a session, and that the security controls survive contact with a
 * browser's cookie handling.
 *
 * The E2E run uses its OWN database (`kurdora_e2e`), created and migrated by
 * `e2e/global-setup.ts`, so it never touches development data.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Auth state is cookie-based and per-test; parallel workers would race on
  // the shared seed data and on rate-limit counters keyed by IP.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'test-results/e2e-report' }]]
    : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          /*
           * CI installs its own browser with `playwright install chromium`, so
           * this is normally undefined. It exists for environments that ship a
           * pre-installed Chromium whose build number does not match the
           * pinned @playwright/test version — pointing at the existing binary
           * is correct there, and downloading a second copy is not.
           */
          ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
            : {}),
          // Containers commonly run as root without a usable sandbox.
          ...(process.env.PLAYWRIGHT_NO_SANDBOX ? { args: ['--no-sandbox'] } : {}),
        },
      },
    },
  ],
  webServer: {
    // A production build, not `next dev`: the dev server behaves differently
    // around caching and error boundaries, and testing it would prove the
    // wrong thing.
    // The database is prepared HERE, not in globalSetup: Playwright starts
    // the web server first, so anything global setup does arrives too late.
    command: `pnpm exec tsx e2e/prepare-db.ts && pnpm exec next start --port ${PORT}`,
    url: `${baseURL}/en`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      APP_URL: baseURL,
      // Computed here, not read from global setup: the config is evaluated
      // first, so anything global setup exports arrives too late.
      DATABASE_URL: e2eDatabaseUrl(),
    } as Record<string, string>,
  },
});
