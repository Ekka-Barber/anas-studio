// P06: the `contact` Edge Function's email grammar and IDN handling, without
// a database. The database is a recorder, Turnstile runs against
// Cloudflare's always-pass test secret with `fetch` stubbed, so an accepted
// address reaches the recorder and the exact value `contact_submit` would
// store can be asserted. The database's own CHECK is proven in
// tests/integration/forms.test.ts.
import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleContact } from '../../supabase/functions/_shared/contact.ts'
import type { Rpc } from '../../supabase/functions/_shared/db.ts'

// The database is a recorder: each `contact_submit` call's arguments in order.
const recorded = { params: [] as unknown[][] }
const recorderRpc: Rpc = async (_fn, args) => {
  recorded.params.push(Object.values(args))
  return { id: randomUUID(), duplicate: false }
}
const contactPost = (request: Request) => handleContact(request, recorderRpc)

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
  return new Request('http://127.0.0.1:54321/functions/v1/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
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

describe('contact function origin (D32: the form posts cross-origin)', () => {
  it('answers the CORS preflight for the site origin only', async () => {
    const response = await contactPost(
      new Request('http://127.0.0.1:54321/functions/v1/contact', { method: 'OPTIONS', headers: { origin: 'http://localhost:3000' } }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
  })

  it.each([
    ['another site', { origin: 'https://evil.test' }],
    ['no Origin header', {}],
  ])('refuses %s before anything is stored', async (_label, extra) => {
    const request = contactRequest('guest@example.com')
    const headers = new Headers(request.headers)
    headers.delete('origin')
    for (const [name, value] of Object.entries(extra)) headers.set(name, value)
    const response = await contactPost(new Request(request.url, { method: 'POST', headers, body: await request.text() }))
    expect(response.status).toBe(403)
    expect(recorded.params).toHaveLength(0)
  })
})
