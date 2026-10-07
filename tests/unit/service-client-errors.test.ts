// Two places where a server-side failure must not be reported as the caller's
// fault, both through the service-role client (faked here):
// - `staffFromRequest`: an Auth outage while verifying a valid token is a
//   thrown error (callers answer 500), a bad or expired token is `null` (401)
//   (FIX-db-2).
// - `storageStore().read`: only a missing object is `null` (MISSING_PART); any
//   other Storage failure throws (EF-admin-3).
import { AuthApiError, AuthRetryableFetchError, StorageApiError } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { storageStore } from '../../supabase/functions/_shared/admin.ts'
import { staffFromRequest } from '../../supabase/functions/_shared/staff.ts'

const hoisted = vi.hoisted(() => ({ client: undefined as unknown }))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  serviceClient: () => hoisted.client,
  serviceRpc: () => async () => null,
}))

const OWNER = '11111111-1111-4111-8111-111111111111'
const request = new Request('http://127.0.0.1:54321/functions/v1/admin', { headers: { authorization: 'Bearer token' } })

/** Auth answers `result` to the token check and the staff lookup answers `staff`; returns the token check's spy. */
function authReturns(result: unknown, staff: unknown = { data: { role: 'owner', active: true }, error: null }) {
  const getClaims = vi.fn(async () => result)
  hoisted.client = {
    auth: { getClaims },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => staff }) }),
    }),
  }
  return getClaims
}

describe('staffFromRequest: Auth failures', () => {
  it('a bad or expired token is unauthenticated (null)', async () => {
    authReturns({ data: null, error: new AuthApiError('invalid JWT', 401, 'bad_jwt') })
    expect(await staffFromRequest(request)).toBeNull()
  })

  it.each([
    ['a network failure or 5xx from Auth', new AuthRetryableFetchError('fetch failed', 503)],
    ['an Auth server error', new AuthApiError('unexpected failure', 500, 'unexpected_failure')],
  ])('%s throws, so callers answer 500 instead of 401', async (_label, error) => {
    authReturns({ data: null, error })
    await expect(staffFromRequest(request)).rejects.toThrow('AUTH_UNAVAILABLE')
  })

  it('a verified token resolves the staff role', async () => {
    authReturns({ data: { claims: { sub: OWNER } }, error: null })
    expect(await staffFromRequest(request)).toEqual({ userId: OWNER, role: 'owner', recentTotp: false })
  })
})

// FABLE-AUDIT T-10: only an active staff row with a role the app knows gives a role. A genuine token without one is
// role null (callers answer 403), a failed lookup is a server fault (500), and a header that is not a bearer token is
// unauthenticated without asking Auth at all.
describe('staffFromRequest: the staff row and the header', () => {
  const verified = { data: { claims: { sub: OWNER } }, error: null }

  it.each([
    ['a revoked owner (active false)', { data: { role: 'owner', active: false }, error: null }],
    ['an active row with a role the app does not know', { data: { role: 'superuser', active: true }, error: null }],
    ['no staff row at all', { data: null, error: null }],
  ])('%s gives role null, not a role and not 401: the token itself is genuine', async (_label, staff) => {
    authReturns(verified, staff)
    expect(await staffFromRequest(request)).toEqual({ userId: OWNER, role: null, recentTotp: false })
  })

  it('a staff lookup that fails throws STAFF_LOOKUP_FAILED, so callers answer 500', async () => {
    authReturns(verified, { data: null, error: { message: 'connection refused', code: 'XX000' } })
    await expect(staffFromRequest(request)).rejects.toThrow('STAFF_LOOKUP_FAILED')
  })

  it.each([
    ['a Basic header', { authorization: 'Basic x' }],
    ['no Authorization header', {}],
  ])('%s is unauthenticated (null) and Auth is never asked', async (_label, headers) => {
    const getClaims = authReturns(verified)
    expect(await staffFromRequest(new Request('http://127.0.0.1:54321/functions/v1/admin', { headers }))).toBeNull()
    expect(getClaims).not.toHaveBeenCalled()
  })
})

describe('storageStore().read: Storage failures', () => {
  const download = (result: unknown) => {
    hoisted.client = { storage: { from: () => ({ download: async () => result }) } }
    return storageStore().read('media-private', 'quarantine/t/original')
  }

  it.each([
    ['a 404 body behind HTTP 400, as Storage answers a missing object', new StorageApiError('Object not found', 400, '404')],
    ['an HTTP 404', new StorageApiError('Not Found', 404, '404')],
  ])('%s is null (the part was never uploaded)', async (_label, error) => {
    expect(await download({ data: null, error })).toBeNull()
  })

  it.each([
    ['a Storage 5xx', new StorageApiError('Bad Gateway', 503, '503')],
    ['a network failure', { name: 'StorageUnknownError', message: 'fetch failed' }],
  ])('%s throws instead of reading as a missing part', async (_label, error) => {
    await expect(download({ data: null, error })).rejects.toThrow('READ_FAILED')
  })

  it('an object comes back as its bytes', async () => {
    const bytes = await download({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null })
    expect([...bytes!]).toEqual([1, 2, 3])
  })
})
