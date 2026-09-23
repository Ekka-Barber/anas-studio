/**
 * Environment access for the server runtime.
 *
 * Rules that must not be relaxed:
 * - Unconfigured means unavailable. There are no defaults for secrets, URLs or
 *   credentials; a missing variable throws instead of degrading silently.
 * - Values are read from the environment only. Never inline a secret here and
 *   never log a resolved value.
 */

/** Hosts that are accepted as a disposable local database. */
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal'])

/**
 * The one runtime switch (I19/D27). `RUNTIME_TARGET=node` is set only by the
 * Docker image/VM's runtime environment, never inferred from the absence of
 * Cloudflare context — the CLI (migrations, type generation) also lacks that
 * context and must never select the node target's storage adapter or autoRun.
 */
export function isNodeRuntimeTarget(): boolean {
  return process.env.RUNTIME_TARGET === 'node'
}

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Missing required environment variable: ${name}`)
    this.name = 'MissingEnvError'
  }
}

/** Reads a required environment variable or throws. Never returns a default. */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new MissingEnvError(name)
  }
  return value
}

/** Reads an optional environment variable. */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

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
  return LOCAL_DB_HOSTS.has(parsed.hostname)
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
