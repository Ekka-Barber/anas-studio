import { optionalEnv, secretsMatch } from './env'

const BEARER_PREFIX = 'Bearer '

/** True only when the request carries the exact configured revalidate secret. */
export function isAuthorizedRevalidateRequest(headers: Headers, secret: string): boolean {
  const authorization = headers.get('authorization')
  if (!authorization?.startsWith(BEARER_PREFIX)) return false
  return secretsMatch(authorization.slice(BEARER_PREFIX.length), secret)
}

export interface RevalidatePayload {
  tags: string[]
  paths: string[]
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
}

/**
 * Validates the `POST /api/revalidate` body: `{ tags?: string[], paths?: string[] }`,
 * at least one of the two non-empty. Returns `null` for anything else so the
 * caller can answer 400 without guessing at a partial invalidation.
 */
export function parseRevalidatePayload(body: unknown): RevalidatePayload | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  const tags = record.tags ?? []
  const paths = record.paths ?? []
  if (!isStringArray(tags) || !isStringArray(paths)) return null
  if (tags.length === 0 && paths.length === 0) return null
  return { tags, paths }
}

/** Cache tag for one RuntimeProbe document's public page. */
export function runtimeProbeTag(id: string): string {
  return `runtime-probe:${id}`
}

const NOTIFY_TIMEOUT_MS = 5_000

/**
 * Node target only: tells the public Worker which tags changed, so its
 * cached page falls stale and re-renders from the database on next visit.
 *
 * Unconfigured means unavailable: if `SITE_URL` or `REVALIDATE_SECRET` is not
 * set, this logs and returns rather than guessing at the Worker's origin.
 * Never throws and is never awaited by its caller — a revalidation failure
 * must not block or fail an admin save.
 */
export async function notifyRevalidate(tags: string[]): Promise<void> {
  if (tags.length === 0) return
  const siteUrl = optionalEnv('SITE_URL')
  const secret = optionalEnv('REVALIDATE_SECRET')
  if (!siteUrl || !secret) {
    console.warn('[revalidate] SITE_URL or REVALIDATE_SECRET not set; skipping notification.')
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS)
  try {
    const response = await fetch(new URL('/api/revalidate', siteUrl), {
      method: 'POST',
      headers: { authorization: `${BEARER_PREFIX}${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tags }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error(`[revalidate] notification failed with status ${response.status}`)
    }
  } catch (error) {
    console.error('[revalidate] notification failed', error)
  } finally {
    clearTimeout(timeout)
  }
}
