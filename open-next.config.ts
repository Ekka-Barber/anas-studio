import { defineCloudflareConfig } from '@opennextjs/cloudflare'

/**
 * OpenNext Cloudflare adapter configuration.
 *
 * No incremental cache, tag cache or revalidation queue override is configured:
 * authorization, publication and inventory reads must reach the database, and
 * the explicit public-content caching policy is P01/P04 work with its own
 * invalidation proof. Adding a cache override here would silently change what
 * P00 measures.
 */
export default defineCloudflareConfig()
