/**
 * Staff identity for the staff-facing Edge Functions (D32; was
 * `src/lib/staff-auth.ts`): the bearer token is verified with Supabase Auth
 * (`auth.getClaims`), then the caller's active role is read from `staff`.
 *
 * `null` means unauthenticated (a missing, bad or unverifiable token). A
 * valid token whose caller has no active staff row yields `role: null`, so
 * callers answer 403, not 401: the token itself is genuine. A revoked member
 * (`active = false`) loses access on the next call, like RLS (D13).
 */
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
  if (error || typeof userId !== 'string') return null
  const staff = await client.from('staff').select('role, active').eq('user_id', userId).maybeSingle()
  if (staff.error) return null
  const role = staff.data?.active && ROLES.has(staff.data.role) ? (staff.data.role as StaffRole) : null
  return { userId, role, recentTotp: hasRecentTotp(claims ?? {}, Math.floor(Date.now() / 1000)) }
}
