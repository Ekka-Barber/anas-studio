import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache'
import d1NextTagCache from '@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache'

/**
 * OpenNext Cloudflare adapter configuration (I20/D27).
 *
 * Per https://opennext.js.org/cloudflare/caching (fetched 2026-09-23): "Everything
 * on this page only concerns SSG/ISR and the data cache, SSR route[s] will work
 * out of the box without any caching config." This is public-page caching only —
 * it does not touch, and cannot serve stale, authorization or inventory reads.
 * Those stay dynamic and continue to reach the database on every request.
 *
 * `enableCacheInterception: true` answers a Worker request straight from the
 * incremental cache before it reaches the Next.js server, avoiding the
 * per-request Next server-side render cost on a cache hit — this is what P00
 * measured as CPU over the Workers Free 10ms limit on public pages that read
 * data (I20).
 *
 * Replaces the read-only `staticAssetsIncrementalCache` used while the only
 * public page was static placeholder text. The public probe route
 * (`src/app/(public)/probe/[id]/page.tsx`) now reads through Payload, and the
 * admin that changes that data runs in a separate Node deployment (D27), so
 * the cache has to support on-demand revalidation from outside the Worker:
 *
 * - `r2-incremental-cache`: stores rendered pages/data in the
 *   `NEXT_INC_CACHE_R2_BUCKET` binding (`wrangler.jsonc`).
 * - `d1-next-tag-cache`: tracks `revalidateTag`/`revalidatePath` calls in the
 *   `NEXT_TAG_CACHE_D1` binding's `revalidations` table, so a cached entry
 *   whose tag was revalidated is served stale-then-refreshed or refetched
 *   rather than served forever. The interceptor above checks this on every
 *   cache hit (`@opennextjs/aws` `core/routing/cacheInterceptor.js`).
 *
 * No queue: per the doc above (fetched 2026-09-23), "A queue must be setup
 * for projects using Time-Based revalidation. It is not needed when
 * revalidation is not used nor only On-Demand revalidation is used." This app
 * only calls `revalidateTag`/`revalidatePath` from `POST /api/revalidate`; it
 * never uses time-based ISR (`export const revalidate = <seconds>`), so there
 * is no `queue` option here and no Durable Object queue binding in
 * `wrangler.jsonc`.
 *
 * No regional cache (`withRegionalCache`): reading
 * `overrides/incremental-cache/regional-cache.js`, its main benefit is
 * bypassing the D1 tag-cache check on a hit, which the same source says needs
 * Automatic Cache Purge to stay safe — and cache purge needs a Cloudflare
 * zone, i.e. the custom domain, which is not attached yet (D25/I19). Adding
 * it now would trade a correctness guarantee for a performance gain this
 * single-document P00 spike does not need; revisit once `anas.studio` is a
 * real zone.
 *
 * No cache purge (`cachePurge`): same reason — it can "only [be enabled] on a
 * zone", which does not exist yet, and it purges a separate CDN-edge cache
 * layer, not the D1 tag check this on-demand loop already relies on to work.
 *
 * No `WORKER_SELF_REFERENCE` service binding: reading the adapter source,
 * that binding is only consumed by the Durable Object queue and by the Pages
 * Router's `res.revalidate` patch — this app uses neither.
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  tagCache: d1NextTagCache,
  enableCacheInterception: true,
})
