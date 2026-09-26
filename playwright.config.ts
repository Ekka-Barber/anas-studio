import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against `next dev` and the local Supabase stack, which
 * serves the Edge Functions and Storage (D32). `next dev` renders the static
 * pages on request, so a publish shows at once; the built export itself is
 * checked by `pnpm check:export` and a static smoke. The origin must be
 * `http://localhost:3000`, the `SITE_URL` the local functions accept.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './artifacts/acceptance/P00/playwright',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: './artifacts/acceptance/P00/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm run dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
})
