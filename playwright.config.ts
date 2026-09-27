import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against `next dev` and the local Supabase stack, which
 * serves the Edge Functions and Storage (D32). `next dev` renders the static
 * pages on request, so a publish shows at once; the built export itself is
 * checked by `pnpm check:export` and a static smoke. The origin must be
 * `http://localhost:3000`, the `SITE_URL` the local functions accept.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

// Routine runs write to the git-ignored test-results/, so they never overwrite
// an accepted package's report; an acceptance run names its package
// (ACCEPTANCE_PACKAGE=P06) to keep the report under artifacts/acceptance/P06/.
const acceptancePackage = process.env.ACCEPTANCE_PACKAGE
if (acceptancePackage && !/^P\d{2}$/.test(acceptancePackage)) {
  throw new Error(`ACCEPTANCE_PACKAGE must look like P06, got "${acceptancePackage}"`)
}
const runDir = acceptancePackage ? `./artifacts/acceptance/${acceptancePackage}` : './test-results'

// I37: a cold `next dev` sharing `.next` with an earlier `pnpm build` or dev
// cache once answered 404 for an existing admin route. The server Playwright
// starts builds into its own folder, emptied first; every build empties it too.
const e2eDistDir = '.next/e2e'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `${runDir}/playwright`,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: `${runDir}/playwright-report`, open: 'never' }],
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
        command: `node -e "require('node:fs').rmSync('${e2eDistDir}', { recursive: true, force: true })" && pnpm run dev`,
        env: { NEXT_DIST_DIR: e2eDistDir },
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
})
