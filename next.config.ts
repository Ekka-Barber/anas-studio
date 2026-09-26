import type { NextConfig } from 'next'

/**
 * D32: the site is a static export (`out/`) served by Cloudflare Pages. Pages
 * are built from published content at build time and rebuilt through a
 * Pages deploy hook after each publish; the admin is a client app that talks
 * to Supabase directly; server work lives in Supabase Edge Functions
 * (`supabase/functions/`). Nothing here runs on a server at request time.
 */
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  poweredByHeader: false,
  // D15: no Sharp and no Cloudflare Images baseline; a static export has no
  // image optimizer to run anyway.
  images: { unoptimized: true },
  typescript: {
    // `pnpm typecheck` owns type checking; never ignore errors.
    ignoreBuildErrors: false,
  },
  // `next dev` otherwise auto-writes a managed block into AGENTS.md/CLAUDE.md
  // for a detected AI coding agent (`config.agentRules !== false` gates it,
  // per `node_modules/next/dist/server/lib/app-info-log.js`). This repository
  // already has its own AGENTS.md/CLAUDE.md as the plan of record.
  agentRules: false,
  // Next 16's dev server refuses cross-origin dev resources from 127.0.0.1
  // unless listed, and the admin form then never hydrates (found in P06 local
  // verification); localhost and 127.0.0.1 are the same machine here.
  allowedDevOrigins: ['127.0.0.1'],
  // Unmatched URLs have no single root layout to render inside (each route
  // group has its own), so `src/app/global-not-found.tsx` serves them (I27);
  // in the export it becomes `404.html`, which Pages serves for unknown paths.
  experimental: { globalNotFound: true },
}

export default nextConfig
