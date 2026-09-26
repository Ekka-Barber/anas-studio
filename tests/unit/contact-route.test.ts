// P06: the contact route's email grammar and IDN handling, without a
// database. `@/lib/db` is replaced by a recorder, Turnstile runs against
// Cloudflare's always-pass test secret with `fetch` stubbed, so an accepted
// address reaches the recorder and the exact value `contact_submit` would
// store can be asserted. The database's own CHECK is proven in
// tests/integration/forms.test.ts.
import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST as contactPost } from '../../src/app/api/contact/route'

const recorded = vi.hoisted(() => ({ params: [] as unknown[][] }))

// vitest resolves no `@/` alias, so every `@/lib/*` import of the route is
// mocked: the database with a recorder, the rest with the real modules.
vi.mock('@/lib/db', () => ({
  withDb: (run: (client: { query: (sql: string, params: unknown[]) => Promise<unknown> }) => Promise<unknown>) =>
    run({
      query: async (_sql: string, params: unknown[]) => {
        recorded.params.push(params)
        return { rows: [{ t: { id: randomUUID(), duplicate: false } }] }
      },
    }),
}))
vi.mock('@/lib/env', async () => vi.importActual('../../src/lib/env'))
vi.mock('@/lib/rate-limit', async () => vi.importActual('../../src/lib/rate-limit'))
vi.mock('@/lib/turnstile', async () => vi.importActual('../../src/lib/turnstile'))

beforeEach(() => {
  recorded.params.length = 0
  vi.stubEnv('SITE_URL', 'http://localhost:3000')
  vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA')
  vi.stubEnv('TOKEN_HASH_PEPPER', 'unit-test-pepper')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ success: true, hostname: 'example.com', 'error-codes': [] })),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function contactRequest(email: string): Request {
  return new Request('http://localhost:3000/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'زائر',
      email,
      message: 'رسالة اختبار',
      submissionKey: randomUUID(),
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    }),
  })
}

/** The email argument `contact_submit` received (its third parameter). */
function storedEmail(): unknown {
  return recorded.params[0]?.[2]
}

describe('contact route email grammar', () => {
  it('stores a plain address lowercased', async () => {
    const response = await contactPost(contactRequest('  Guest@Example.COM '))
    expect(response.status).toBe(201)
    expect(storedEmail()).toBe('guest@example.com')
  })

  it('stores an internationalised domain as punycode, the form the SQL CHECK accepts', async () => {
    const response = await contactPost(contactRequest('user@مثال.السعودية'))
    expect(response.status).toBe(201)
    expect(storedEmail()).toBe('user@xn--mgbh0fb.xn--mgberp4a5d4ar')
  })

  it.each([
    ['mailto header smuggling', 'x@evil.test?bcc=attacker%40evil.test&body=hello'],
    ['a path after an IDN host', 'x@ü.test/extra'],
    ['a query after an IDN host', 'x@ü.test?bcc=a@b.test'],
    ['a fragment after an IDN host', 'x@ü.test#frag'],
    ['a port after an IDN host', 'x@ü.test:25'],
    ['a percent escape in an IDN host', 'x@ü%41.test'],
    ['a non-ASCII local part', 'أنس@example.com'],
    ['a local part over 64 characters', `${'a'.repeat(65)}@example.com`],
    ['a numeric TLD', 'x@example.123'],
  ])('refuses %s before anything is stored', async (_label, email) => {
    const response = await contactPost(contactRequest(email))
    expect(response.status).toBe(422)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID')
    expect(recorded.params).toHaveLength(0)
  })
})
