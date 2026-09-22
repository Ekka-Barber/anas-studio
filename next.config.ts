import { withPayload } from '@payloadcms/next/withPayload'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // D15: no Sharp and no Cloudflare Images baseline. Next's optimizer is the
  // only code path that would pull a native resizer into the runtime, so it is
  // switched off here rather than merely left unused.
  images: { unoptimized: true },
  turbopack: {
    resolveAlias: {
      // `drizzle-kit/api` is only ever reached by `@payloadcms/drizzle`'s lazy
      // `requireDrizzleKit()`, which runs for `push` and `migrate:create`. This
      // deployment uses `push: false` and runs migrations from the CLI, so the
      // module is dead code inside the Worker — but it is 7 MB of dead code, and
      // Turbopack rewrites it into a hashed external specifier that the OpenNext
      // esbuild pass then cannot resolve, failing `pnpm build:worker`.
      // Aliasing it to a Node builtin keeps it out of the bundle. If the lazy
      // require were ever reached at runtime it would fail loudly rather than
      // silently do the wrong thing.
      'drizzle-kit/api': 'node:util',
    },
  },
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

export default withPayload(nextConfig)
