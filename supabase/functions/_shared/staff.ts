/**
 * Staff identity for the staff-facing Edge Functions (D32; was
 * `src/lib/staff-auth.ts`): the bearer token is verified with Supabase Auth
 * (`auth.getClaims`), then the caller's active role is read from `staff`.
 *
 * `null` means unauthenticated (a missing, bad or expired token); a failed
 * `staff` lookup or an Auth outage (a network failure or 5xx while verifying
 * the token) throws, so callers answer a server error, never 401. A
 * valid token whose caller has no active staff row yields `role: null`, so
 * callers answer 403, not 401: the token itself is genuine. A revoked member
 * (`active = false`) loses access on the next call, like RLS (D13).
 */
import { isAuthRetryableFetchError } from '@supabase/supabase-js'

import { serviceClient } from './db.ts'
import { hasRecentTotp } from './recent-totp.ts'

export type StaffRole = 'owner' | 'editor' | 'operations'

export interface StaffIdentity {
  userId: string
  role: StaffRole | null
  /** aal2 with a TOTP verification from the last five minutes (D13 step-up). */
  recentTotp: boolean
}

export type StaffResolver = (request: Request) => Promise<StaffIdentity | null>

const ROLES = new Set<string>(['owner', 'editor', 'operations'])

/** The default resolver: Supabase Auth, then the `staff` row. */
export const staffFromRequest: StaffResolver = async (request) => {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const client = serviceClient()
  const { data, error } = await client.auth.getClaims(header.slice('Bearer '.length))
  const claims = data?.claims
  const userId = claims?.sub
  if (error || typeof userId !== 'string') {
    // getClaims returns every AuthError instead of throwing it: a bad or
    // expired token is 401, but an Auth outage on a valid session is not.
    if (error && (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500)) throw new Error('AUTH_UNAVAILABLE')
    return null
  }
  const staff = await client.from('staff').select('role, active').eq('user_id', userId).maybeSingle()
  if (staff.error) throw new Error('STAFF_LOOKUP_FAILED')
  const role = staff.data?.active && ROLES.has(staff.data.role) ? (staff.data.role as StaffRole) : null
  return { userId, role, recentTotp: hasRecentTotp(claims ?? {}, Math.floor(Date.now() / 1000)) }
}
