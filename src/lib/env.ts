/**
 * Environment access for the Next build and the test runner. The runtime
 * helpers live with the Edge Functions (`supabase/functions/_shared/env.ts`)
 * and are re-exported here for build-time loaders and tests; the database
 * guard below is only for `pnpm test:db`.
 */
export { MissingEnvError, optionalEnv, requireEnv, secretsMatch } from '../../supabase/functions/_shared/env.ts'
import { LOCAL_HOSTS } from '../../supabase/functions/_shared/env.ts'

/**
 * True only for a PostgreSQL URL that points at a loopback host.
 * Used to keep destructive test runs away from hosted databases.
 */
export function isLocalDatabaseUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return false
  }
  // `pg` takes the host from a `?host=` parameter over the URL's own host.
  if (parsed.searchParams.has('host')) {
    return false
  }
  return LOCAL_HOSTS.has(parsed.hostname)
}

/**
 * Gate for `pnpm test:db`. Database tests may only run against a disposable
 * local PostgreSQL instance, and only when the runner opted in explicitly.
 *
 * Throws (never returns a boolean the caller can ignore) so a misconfigured
 * run fails with a non-zero exit instead of quietly touching a hosted database.
 */
export function assertLocalTestDatabase(): void {
  if (process.env.TEST_ENV !== 'local') {
    throw new Error('Refusing to run database tests: TEST_ENV must be exactly "local".')
  }
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('Refusing to run database tests: DATABASE_URL is not set.')
  }
  if (!isLocalDatabaseUrl(url)) {
    // The URL itself is never printed: it carries credentials.
    throw new Error(
      'Refusing to run database tests: DATABASE_URL does not point at a local PostgreSQL host.',
    )
  }
}
