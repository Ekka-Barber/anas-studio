/**
 * Staff identity for server-side entry points (P06 round 2): verifies an
 * access token with Supabase Auth (`auth.getClaims`), then reads the caller's
 * staff role through the Data API with that token — the same two steps
 * `src/app/api/preview/route.ts` performs inline (that route also needs the
 * token's `exp` for its cookie, so it keeps its own copy).
 *
 * `null` means unauthenticated (a bad or unverifiable token). A valid token
 * whose caller has no active staff role yields `role: null` — callers answer
 * 403, not 401, because the token itself is genuine.
 */
import { requireEnv } from './env'
import { getSupabaseServerClient } from './supabase/server'

export type StaffRole = 'owner' | 'editor' | 'operations'

export interface StaffIdentity {
  userId: string
  role: StaffRole | null
}

export async function staffFromToken(accessToken: string): Promise<StaffIdentity | null> {
  const { data, error } = await getSupabaseServerClient().auth.getClaims(accessToken)
  if (error || !data) return null

  const roleResponse = await fetch(`${requireEnv('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/rpc/current_staff_role`, {
    method: 'POST',
    headers: {
      apikey: requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
    cache: 'no-store',
  })
  if (!roleResponse.ok) return null
  const role = (await roleResponse.json()) as unknown
  if (role !== 'owner' && role !== 'editor' && role !== 'operations') {
    return { userId: typeof data.claims.sub === 'string' ? data.claims.sub : '', role: null }
  }
  return { userId: typeof data.claims.sub === 'string' ? data.claims.sub : '', role }
}
