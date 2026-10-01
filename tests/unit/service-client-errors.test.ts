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

function authReturns(result: unknown) {
  hoisted.client = {
    auth: { getClaims: async () => result },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'owner', active: true }, error: null }) }) }),
    }),
  }
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
