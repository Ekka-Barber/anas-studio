import { secretsMatch } from './env'

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
