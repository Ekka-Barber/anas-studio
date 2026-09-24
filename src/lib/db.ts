import { getCloudflareContext } from '@opennextjs/cloudflare/cloudflare-context'
import { Client } from 'pg'

/**
 * The Worker's only database access (D29, D26).
 *
 * Runtime login is `app_server`: no RLS bypass, no DDL, no table grants —
 * EXECUTE on named `public` functions only (`supabase/migrations`). The
 * connection string comes from the Cloudflare `HYPERDRIVE` binding, whose
 * origin is the Supabase transaction pooler with query caching disabled, so
 * every call reaches PostgreSQL. There is no `DATABASE_URL` fallback here:
 * that is the separate, non-pooled migration credential (D26) and must never
 * serve a request.
 *
 * One `pg.Client` per call, not a pool: a Workers isolate is short-lived and
 * the connection pool that matters lives in Hyperdrive, not in the isolate.
 * No prepared-statement name is ever set — node-postgres then uses the
 * unnamed extended query protocol, which is what a transaction-mode pooler
 * supports. Client-side timeouts make a stale pooled socket fail the call
 * instead of hanging the request (P00 recorded a hang without them).
 */
export async function withDb<T>(query: (client: Client) => Promise<T>): Promise<T> {
  const { connectionString } = getCloudflareContext().env.HYPERDRIVE
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000, query_timeout: 10_000 })
  await client.connect()
  try {
    return await query(client)
  } finally {
    await client.end()
  }
}
