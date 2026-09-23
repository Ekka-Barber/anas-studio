import { withPayload } from '@payloadcms/next/withPayload'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Produces `.next/standalone`, the self-contained Node server the Docker
  // node target (I19/D27) runs. `pnpm build:worker` is unaffected: OpenNext
  // already forces the equivalent `NEXT_PRIVATE_STANDALONE=true` internally
  // (`@opennextjs/aws` `build/buildNextApp.js`) regardless of this setting.
  output: 'standalone',
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
      // `src/payload/storage.ts` statically imports `@payloadcms/storage-s3`
      // (and its AWS SDK dependency tree) so the node target can select it at
      // runtime, but it is only ever called when `RUNTIME_TARGET=node`. Built
      // for any other target, that import is dead code the bundler cannot
      // prove unreachable on its own, and it measured as a ~7% Worker bundle
      // size increase (I19/D27). The Docker build stage sets
      // `RUNTIME_TARGET=node` before building, so this only strips it from
      // builds that are not the node target — same "fail loudly if the lazy
      // path is ever actually reached" reasoning as `drizzle-kit/api` above.
      ...(process.env.RUNTIME_TARGET === 'node' ? {} : { '@payloadcms/storage-s3': 'node:util' }),
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
