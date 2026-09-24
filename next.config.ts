import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // D15: no Sharp and no Cloudflare Images baseline. Next's optimizer is the
  // only code path that would pull a native resizer into the runtime, so it is
  // switched off here rather than merely left unused.
  images: { unoptimized: true },
  outputFileTracingIncludes: {
    // `pg` picks `pg-cloudflare`'s CloudflareSocket at runtime on Workers, but
    // Next's tracer resolves that package under the `default` export condition
    // and copies only its empty stub. The OpenNext bundler resolves it under the
    // `workerd` condition and needs the real implementation, so force it in.
    '**/*': ['./node_modules/.pnpm/pg-cloudflare@*/node_modules/pg-cloudflare/**'],
  },
  typescript: {
    // `pnpm typecheck` owns type checking; never ignore errors.
    ignoreBuildErrors: false,
  },
  // `next dev` otherwise auto-writes a managed block into AGENTS.md/CLAUDE.md
  // for a detected AI coding agent (`config.agentRules !== false` gates it,
  // per `node_modules/next/dist/server/lib/app-info-log.js`). This repository
  // already has its own AGENTS.md/CLAUDE.md as the plan of record.
  agentRules: false,
  // Unmatched URLs have no single root layout to render inside (each route
  // group has its own), so `src/app/global-not-found.tsx` serves them (I27).
  experimental: { globalNotFound: true },
}

// Gives `next dev` the same Cloudflare bindings (HYPERDRIVE, R2) that the
// deployed Worker sees, through wrangler's local simulation.
//
// Guarded: this helper starts a miniflare instance and demands a local
// Hyperdrive connection string, so calling it during `next build` would make a
// production build depend on a local database. The deployed Worker gets its
// context from the OpenNext entrypoint instead.
if (process.env.NODE_ENV === 'development') {
  void initOpenNextCloudflareForDev()
}

export default nextConfig
