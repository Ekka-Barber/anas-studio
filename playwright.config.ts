import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against `next dev` and the local Supabase stack, which
 * serves the Edge Functions and Storage (D32). `next dev` renders the static
 * pages on request, so a publish shows at once; the built export itself is
 * checked by `pnpm check:export` and a static smoke. The origin must be
 * `http://localhost:3000`, the `SITE_URL` the local functions accept. The Moyasar
 * emulator (`pnpm emulator`) runs beside them: checkout's `create` makes its
 * invoice there (P08).
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

// Routine runs write to the git-ignored test-results/, so they never overwrite
// an accepted package's report; an acceptance run names its package
// (ACCEPTANCE_PACKAGE=P06) to keep the report under artifacts/acceptance/P06/.
// The specs' own screenshots follow the same rule per package (tests/e2e/shots.ts):
// a package's evidence folder is written only when ACCEPTANCE_PACKAGE names that package.
const acceptancePackage = process.env.ACCEPTANCE_PACKAGE
// The recorded packages: P00-P07, CLEANUP-1, AUDIT-1, AUDIT-2 and DESIGN-B.
if (acceptancePackage && !/^(P\d{2}|[A-Z]+-(\d+|[A-Z]))$/.test(acceptancePackage)) {
  throw new Error(`ACCEPTANCE_PACKAGE must look like P06, CLEANUP-1 or DESIGN-B, got "${acceptancePackage}"`)
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
  webServer: [
    ...(process.env.PLAYWRIGHT_BASE_URL
      ? []
      : [
          {
            command: `node -e "require('node:fs').rmSync('${e2eDistDir}', { recursive: true, force: true })" && pnpm run dev`,
            env: { NEXT_DIST_DIR: e2eDistDir },
            url: baseURL,
            reuseExistingServer: true,
            timeout: 180_000,
          },
        ]),
    // P08: the local Moyasar emulator (a test harness, never Moyasar) on the port the local functions reach it on, so
    // every suite that gets as far as checkout has an invoice step to talk to. A running `pnpm emulator` is reused.
    {
      command: 'pnpm emulator',
      port: 54390,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
