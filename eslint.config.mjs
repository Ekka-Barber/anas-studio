import nextConfig from 'eslint-config-next/core-web-vitals'

/**
 * Flat config. Only application code is linted: the repository also holds the
 * frozen design sources, the archive and the planning material, none of which
 * this package may touch.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'node_modules/**',
      // Deno Edge Functions: checked by the Supabase edge runtime, not by the Next toolchain.
      'supabase/functions/**',
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
      '.adal/**',
      '.claude/**',
      '.cursor/**',
      '.gemini/**',
      '.grok/**',
      '.kiro/**',
      '.windsurf/**',
      // Generated files with a single generator as their owner.
      'next-env.d.ts',
    ],
  },
  ...nextConfig,
]

export default config
