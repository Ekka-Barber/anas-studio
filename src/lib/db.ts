import { getCloudflareContext } from '@opennextjs/cloudflare/cloudflare-context'
import type { PoolConfig } from 'pg'

import { isNodeRuntimeTarget, requireEnv } from './env'

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
 * Node target (`RUNTIME_TARGET=node`, I19/D27): `CMS_DATABASE_URL`, the
 * runtime transaction-pooler credential. It never falls back to
 * `DATABASE_URL` — that is the separate D26 migration credential and
 * `.env.example` forbids its runtime use.
 *
 * Otherwise: Hyperdrive binding (Worker request, or `next dev` with wrangler's
 * local bindings) -> `DATABASE_URL` (CLI: migrations, type generation, local
 * tooling).
 */
export function resolveCmsConnectionString(): string {
  if (isNodeRuntimeTarget()) {
    return requireEnv('CMS_DATABASE_URL')
  }
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

/**
 * node-postgres options for the Node admin target (I19/D27).
 *
 * A normal long-lived pool, unlike the Worker's per-isolate `maxUses: 1`: the
 * Node server keeps its own connections open across requests instead of
 * retiring one after a single checkout. `max` stays small because the
 * transaction pooler multiplexes many client connections onto few Postgres
 * backends. `query_timeout` and `connectionTimeoutMillis` are both
 * client-side node-postgres limits, so a stale pooled socket fails the query
 * instead of hanging — ISSUES I18 records a 600-second scheduled invocation
 * with no `statement_timeout` as the likely cause.
 *
 * No prepared-statement name is set here either: the transaction pooler only
 * supports the unnamed extended query protocol, exactly as the Worker path.
 */
export const cmsNodePoolOptions: PoolConfig = {
  get connectionString() {
    return resolveCmsConnectionString()
  },
  max: 5,
  connectionTimeoutMillis: 10_000,
  query_timeout: 10_000,
  allowExitOnIdle: true,
}
