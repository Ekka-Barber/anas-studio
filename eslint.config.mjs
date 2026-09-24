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
      '.open-next/**',
      '.wrangler/**',
      'node_modules/**',
      // Frozen or out-of-scope sources.
      '_archive/**',
      'deploy/**',
      'offer-site-v3/**',
      'BOOK_ASSETS/**',
      'Lyon_Arabic_FONT/**',
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
      'cloudflare-env.d.ts',
      'next-env.d.ts',
    ],
  },
  ...nextConfig,
]

export default config
