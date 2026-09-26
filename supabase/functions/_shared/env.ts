/**
 * Environment access shared by the Edge Functions (Deno) and the unit tests
 * (Node). Rules that must not be relaxed:
 * - Unconfigured means unavailable. There are no defaults for secrets, URLs or
 *   credentials; a missing variable throws instead of degrading silently.
 * - Values are read from the environment only. Never inline a secret here and
 *   never log a resolved value.
 */

type DenoLike = { env: { get(name: string): string | undefined } }

/** Deno's env inside an Edge Function, `process.env` under Node (tests, scripts). */
function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: DenoLike }).Deno
  if (deno) return deno.env.get(name)
  return (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[name]
}

/**
 * Length-independent comparison, so a wrong secret leaks no timing signal.
 * The one implementation for every bearer-secret check.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Missing required environment variable: ${name}`)
    this.name = 'MissingEnvError'
  }
}

/** Reads a required environment variable or throws. Never returns a default. */
export function requireEnv(name: string): string {
  const value = readEnv(name)
  if (typeof value !== 'string' || value.length === 0) {
    throw new MissingEnvError(name)
  }
  return value
}

/** Reads an optional environment variable. */
export function optionalEnv(name: string): string | undefined {
  const value = readEnv(name)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Hosts that mean "this is the local development stack", never a real site. */
export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal'])

/**
 * True only when `SITE_URL` names a real, non-local host. This replaces the
 * old `NODE_ENV === 'production'` test, which Edge Functions do not have:
 * real email and a real Turnstile secret are allowed only for a hosted site,
 * so a local run that happens to hold a real key can never use it.
 */
export function isHostedSite(): boolean {
  const siteUrl = optionalEnv('SITE_URL')
  if (!siteUrl) return false
  try {
    return !LOCAL_HOSTS.has(new URL(siteUrl).hostname)
  } catch {
    return false
  }
}
