import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against the real Worker preview, not `next dev`: the
 * point of P00 is the artifact that actually ships. Run `pnpm build:worker`
 * first — `preview:worker` serves an existing build and does not create one.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8787'

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
        command: 'pnpm run preview:worker',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
})
