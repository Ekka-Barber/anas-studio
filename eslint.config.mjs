import nextConfig from 'eslint-config-next/core-web-vitals'

/**
 * Flat config. Only application code is linted: the repository also holds the
 * frozen design sources, the archive and the planning material, none of which
 * this package may touch. The Deno Edge Functions (`supabase/functions`) are
 * linted too (AUDIT-2 TOOLING-9); `tsc` does not check them (tsconfig
 * excludes them), which only `deno check` can.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'node_modules/**',
      // Generated Playwright output (reports and trace viewers, H2).
      'test-results/**',
      'artifacts/acceptance/*/playwright-report/**',
      // Frozen or out-of-scope sources.
      '_archive/**',
      'deploy/**',
      'offer-site-v3/**',
      'BOOK_ASSETS/**',
      'Thmanyah-Font-Family/**',
      'deliverables/**',
      'PLANS/**',
      'graft/**',
      'artifacts/**',
      '.codegraph/**',
      '.claude/**',
      // Generated files with a single generator as their owner.
      'next-env.d.ts',
    ],
  },
  ...nextConfig,
]

export default config
