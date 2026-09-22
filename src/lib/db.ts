import { getCloudflareContext } from '@opennextjs/cloudflare/cloudflare-context'
import type { PoolConfig } from 'pg'

import { requireEnv } from './env'

/**
 * Database connection policy — one owner for every PostgreSQL endpoint choice.
 *
 * Two endpoints exist and they are never interchangeable (D26):
 *
 * - Runtime traffic uses the Cloudflare `HYPERDRIVE` binding, whose origin is
 *   the Supabase transaction pooler. Hyperdrive query caching is disabled at the
 *   configuration level, so authorization and inventory reads reach PostgreSQL.
 * - Migration DDL uses `DATABASE_URL`, a separate non-pooled connection and
 *   credential. It is never used to serve a request.
 *
 * The restricted `payload_runtime` / `finance_runtime` / `migration_owner`
 * roles, their grants and RLS are P03's work, not this module's.
 */

/**
 * Resolves the CMS runtime connection string.
 *
 * Order: Hyperdrive binding (Worker request, or `next dev` with wrangler's local
 * bindings) -> `DATABASE_URL` (CLI: migrations, type generation, local tooling).
 */
export function resolveCmsConnectionString(): string {
  try {
    const hyperdrive = getCloudflareContext().env.HYPERDRIVE
    if (hyperdrive?.connectionString) {
      return hyperdrive.connectionString
    }
  } catch {
    // No Cloudflare context: a Node CLI or test process. Fall through.
  }
  return requireEnv('DATABASE_URL')
}

/**
 * The separate, non-pooled migration endpoint (D26). Migrations must never run
 * over the Hyperdrive/transaction-pooler path.
 */
export function resolveMigrationConnectionString(): string {
  return requireEnv('DATABASE_URL')
}

/**
 * node-postgres options for the Workers runtime.
 *
 * `maxUses: 1` retires a client after a single checkout: Workers isolates are
 * short-lived and the connection pool that matters lives in Hyperdrive, not in
 * the isolate. This is the configuration Cloudflare documented for the Payload
 * Postgres adapter on Workers.
 *
 * No prepared-statement name is ever set. node-postgres uses the unnamed
 * extended query protocol, which is what a transaction-mode pooler supports.
 */
export const cmsPoolOptions: PoolConfig = {
  get connectionString() {
    // Lazily evaluated: `pg.Pool` is constructed when Payload first connects,
    // which on Workers is inside a request or scheduled invocation.
    return resolveCmsConnectionString()
  },
  max: 5,
  maxUses: 1,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
}
