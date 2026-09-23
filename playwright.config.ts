import { defineConfig, devices } from '@playwright/test';

/**
 * TRACE — Playwright e2e config.
 *
 * Locks in the hand-verified UI interactions (selection sync, evidence replay,
 * follow-the-money, the noise filter, and the theme switch) against the real
 * served Euler contract. The app reads committed fixtures only — no Nansen key,
 * no network, no credits — so this runs anywhere `npm ci` runs.
 *
 * The dev port 3000 is deliberately avoided (another local app owns it); the
 * suite builds and serves a production build on 3100 for HMR-free determinism.
 */
const PORT = 3100;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  // `channel: 'chromium'` runs Playwright's bundled full Chromium in the new
  // headless mode instead of the separate chrome-headless-shell download — one
  // fewer binary to fetch, and identical rendering to what users see.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
  webServer: {
    // Production build + start: closer to what ships than `next dev`, and free
    // of dev-overlay/HMR flakiness. Fixtures-only, so no env is required.
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 240_000,
  },
});
