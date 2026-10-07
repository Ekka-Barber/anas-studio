// P06: the `contact` Edge Function's email grammar and IDN handling, without
// a database. The database is a recorder, Turnstile runs against
// Cloudflare's always-pass test secret with `fetch` stubbed, so an accepted
// address reaches the recorder and the exact value `contact_submit` would
// store can be asserted. The database's own CHECK is proven in
// tests/integration/forms.test.ts.
import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fitsContactLimit } from '../../src/components/public/contact/ContactForm'
import { handleContact } from '../../supabase/functions/_shared/contact.ts'
import type { Rpc } from '../../supabase/functions/_shared/db.ts'

// The form imports through the `@/` alias, which the unit config does not
// resolve; its size check needs neither the button nor Turnstile.
vi.mock('@/components/weave/Action', () => ({ ActionButton: () => null }))
vi.mock('@/lib/turnstile', () => ({ useTurnstile: () => ({}) }))

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

describe('contact Turnstile action and hostname (a live secret checks both)', () => {
  // The always-pass test secret skips both checks, so a live-shaped one is used
  // here with siteverify stubbed; the widget renders action 'contact'.
  const siteverify = (body: Record<string, unknown>) =>
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, 'error-codes': [], ...body })))

  beforeEach(() => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '0x4AAAAAAA_live_shaped_secret')
  })

  it('accepts the contact action on the site hostname', async () => {
    siteverify({ action: 'contact', hostname: 'localhost' })
    expect((await contactPost(contactRequest('guest@example.com'))).status).toBe(201)
  })

  it.each([
    ['another action', { action: 'checkout', hostname: 'localhost' }],
    ['another hostname', { action: 'contact', hostname: 'evil.test' }],
  ])('refuses %s with 400 before anything is stored', async (_label, reply) => {
    siteverify(reply)
    const response = await contactPost(contactRequest('guest@example.com'))
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('TURNSTILE')
    expect(recorded.params).toHaveLength(0)
  })

  it('a siteverify that refuses our secret is 503, not "you are not human", and stores nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    siteverify({ success: false, 'error-codes': ['invalid-input-secret'] })
    const response = await contactPost(contactRequest('guest@example.com'))
    expect(response.status).toBe(503)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('TURNSTILE_UNAVAILABLE')
    expect(recorded.params).toHaveLength(0)
    warn.mockRestore()
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

describe('the contact form refuses exactly the bodies the function refuses (EF-ACCESS-09)', () => {
  // A poem: short Arabic lines, each line break written as two characters in the JSON.
  const poem = (lines: number) => Array.from({ length: lines }, () => 'بيت').join('\n')
  const fields = (message: string) => ({ name: 'زائر من تبوك', email: 'guest@example.com', message, website: '' })
  /** The function's answer to those fields with the longest Turnstile token Cloudflare issues (2,048 characters). */
  const answer = async (message: string) => {
    const { name, email } = fields(message)
    const body = JSON.stringify({ name, email, message, submissionKey: randomUUID(), turnstileToken: 'X'.repeat(2048) })
    const request = new Request('http://127.0.0.1:54321/functions/v1/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body,
    })
    return (await contactPost(request)).status
  }

  it('agrees with the function at its 8 KiB limit, where the old message-only check let a poem through', async () => {
    // 750 lines are 5,249 bytes, under the old 5,500-byte message check, yet their body is past 8 KiB.
    expect(new TextEncoder().encode(poem(750)).length).toBeLessThan(5500)
    expect([fitsContactLimit(fields(poem(749))), await answer(poem(749))]).toEqual([true, 201])
    expect([fitsContactLimit(fields(poem(750))), await answer(poem(750))]).toEqual([false, 413])
  })
})
