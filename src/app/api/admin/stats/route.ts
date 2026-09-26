// Relative imports so the route handler can also be imported directly by
// `tests/integration/stats.test.ts` (vitest resolves no path aliases).
import { staffFromToken } from '../../../../lib/staff-auth'
import { ownerStats, type OwnerStats } from '../../../../lib/stats'

/**
 * Owner-only statistics (P06 round 2): `Authorization: Bearer <staff token>`
 * verified with `staffFromToken`; anything but an active owner is refused
 * before the cache is even read. The body carries counts and page paths
 * only — no PII.
 */
export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 5 * 60 * 1000
const NO_STORE = { 'cache-control': 'private, no-store' }

let cached: { at: number; value: OwnerStats } | null = null
// ponytail: a per-isolate single-entry cache — one entry per running Worker
// isolate for at most 5 minutes, so N isolates hold at most N entries. Not a
// shared store; authorization always runs first, so a cached entry can never
// reach a caller that could not have fetched it.

function fail(status: number, code: string): Response {
  return Response.json({ ok: false, error: { code } }, { status, headers: NO_STORE })
}

export async function GET(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return fail(401, 'UNAUTHENTICATED')
  const staff = await staffFromToken(authorization.slice('Bearer '.length))
  if (!staff) return fail(401, 'UNAUTHENTICATED')
  if (staff.role !== 'owner') return fail(403, 'FORBIDDEN')

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Response.json({ ok: true, data: cached.value }, { headers: NO_STORE })
  }
  const value = await ownerStats()
  cached = { at: Date.now(), value }
  return Response.json({ ok: true, data: value }, { headers: NO_STORE })
}
