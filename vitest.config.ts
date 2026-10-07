import { defineConfig } from 'vitest/config'

import { assertLocalTestDatabase } from './src/lib/env.ts'

/**
 * Two run modes:
 *
 * - default (`pnpm test`): unit tests, no database.
 * - `--mode db` (`pnpm test:db`): integration tests that touch a real
 *   PostgreSQL instance. The guard below runs before any test file is
 *   collected, so a run pointed at anything other than a disposable local
 *   database fails immediately with a non-zero exit.
 */
export default defineConfig(({ mode }) => {
  if (mode === 'db') {
    assertLocalTestDatabase()
  }

  return {
    test: {
      environment: 'node',
      include:
        mode === 'db'
          ? ['tests/integration/**/*.test.ts']
          : ['tests/unit/**/*.test.ts'],
      // Playwright owns end-to-end specs.
      exclude: ['tests/e2e/**', 'node_modules/**'],
      // Unit tests run in UTC on every machine. On one set to Asia/Riyadh (the
      // owner's) a formatter that lost its `timeZone: 'Asia/Riyadh'` would still
      // show Riyadh dates and its test would pass; in UTC it fails.
      env: mode === 'db' ? {} : { TZ: 'UTC' },
      // Database tests share one local database and some mutate global state
      // (the last-owner test deactivates other owners), so their files run one
      // at a time.
      fileParallelism: mode !== 'db',
    },
  }
})
