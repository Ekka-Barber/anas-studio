// P06 round 2: `GET /api/admin/stats` against real local JWTs. The route is
// imported and called directly (as the e2e suites reach it over HTTP); the
// analytics module is mocked so the cache behavior is observable by counting
// calls, and no network is touched.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createStaff, signIn, status, type Role } from './support'

// `vi.hoisted` so the mock factory (hoisted with `vi.mock`) can reference it.
const { fetchAnalyticsMock } = vi.hoisted(() => ({
  fetchAnalyticsMock: vi.fn(async () => ({ status: 'unavailable', reason: 'NOT_CONFIGURED' })),
}))

vi.mock('../../src/lib/analytics', () => ({
  fetchAnalytics: () => fetchAnalyticsMock(),
}))

import { GET } from '../../src/app/api/admin/stats/route'

function requestWith(token?: string): Request {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  return new Request('http://local.test/api/admin/stats', { headers })
}

async function tokenFor(email: string): Promise<string> {
  const client = await signIn(email)
  const { data } = await client.auth.getSession()
  if (!data.session) throw new Error('tokenFor: no session after sign-in')
  return data.session.access_token
}

const tokens: Partial<Record<Role | 'revoked-owner', string>> = {}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY
  for (const role of ['owner', 'editor', 'operations'] as const) {
    const { email } = await createStaff(role)
    tokens[role] = await tokenFor(email)
  }
  // A revoked owner: a valid token whose staff row is inactive — 403, not 401,
  // because the token itself is genuine.
  const revoked = await createStaff('owner', { active: false })
  tokens['revoked-owner'] = await tokenFor(revoked.email)
})

beforeEach(() => {
  fetchAnalyticsMock.mockClear()
})

describe('GET /api/admin/stats', () => {
  it('no bearer is 401', async () => {
    const response = await GET(requestWith())
    expect(response.status).toBe(401)
  })

  it('a garbage bearer is 401', async () => {
    const response = await GET(requestWith('not-a-jwt'))
    expect(response.status).toBe(401)
  })

  it('an owner gets not_configured commerce and unavailable analytics, cached for 5 minutes', async () => {
    // Runs first in this file, so the per-isolate cache is empty and the two
    // owner calls below exercise exactly one analytics fetch.
    const first = await GET(requestWith(tokens.owner))
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('private, no-store')
    const body = (await first.json()) as {
      ok: boolean
      data: { generatedAt: string; commerce: { status: string }; analytics: { status: string; reason: string } }
    }
    expect(body.ok).toBe(true)
    expect(body.data.commerce.status).toBe('not_configured')
    expect(body.data.analytics).toEqual({ status: 'unavailable', reason: 'NOT_CONFIGURED' })
    expect(fetchAnalyticsMock).toHaveBeenCalledTimes(1)

    const second = await GET(requestWith(tokens.owner))
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { data: { analytics: { reason: string } } }
    expect(secondBody.data.analytics.reason).toBe('NOT_CONFIGURED')
    expect(fetchAnalyticsMock).toHaveBeenCalledTimes(1) // served from the cache
  })

  it('an editor is 403 without touching the cache or the analytics module', async () => {
    const response = await GET(requestWith(tokens.editor))
    expect(response.status).toBe(403)
    expect(fetchAnalyticsMock).not.toHaveBeenCalled()
  })

  it('an operations member is 403', async () => {
    const response = await GET(requestWith(tokens.operations))
    expect(response.status).toBe(403)
    expect(fetchAnalyticsMock).not.toHaveBeenCalled()
  })

  it('a revoked owner is 403 (a genuine token, no active role)', async () => {
    const response = await GET(requestWith(tokens['revoked-owner']))
    expect(response.status).toBe(403)
    expect(fetchAnalyticsMock).not.toHaveBeenCalled()
  })
})
