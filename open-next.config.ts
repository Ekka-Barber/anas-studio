import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache'

/**
 * OpenNext Cloudflare adapter configuration.
 *
 * Per https://opennext.js.org/cloudflare/caching (fetched 2026-09-22): "Everything
 * on this page only concerns SSG/ISR and the data cache, SSR route[s] will work
 * out of the box without any caching config." This is public-page caching only —
 * it does not touch, and cannot serve stale, authorization or inventory reads.
 * Those stay dynamic and continue to reach the database on every request.
 *
 * `enableCacheInterception: true` answers a Worker request straight from the
 * incremental cache before it reaches the Next.js server, avoiding the
 * per-request Next server-side render cost on a cache hit — this is what P00
 * measured as CPU over the Workers Free 10ms limit on the public route.
 * `staticAssetsIncrementalCache` is the doc's "SSG site" recipe: a read-only
 * cache that serves build-time values straight from Workers Static Assets, with
 * no revalidation support — the right fit for P00's static placeholder public
 * page, which has no revalidation to support. Tag cache and a revalidation
 * queue remain unconfigured because nothing here uses `revalidateTag`,
 * `revalidatePath`, or time-based ISR; that is separate P01/P04 work with its
 * own invalidation proof.
 */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
})
