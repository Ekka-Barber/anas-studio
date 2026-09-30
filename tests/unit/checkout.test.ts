// P07: the `checkout` Edge Function's handler with an injected rpc and
// Turnstile verifier — no network, no database. The database's own invariants
// are proven in tests/integration/checkout.test.ts; here the checks are the
// handler's: the gates (origin, method, content type, size, JSON, schema),
// the normalization and hashing rules, the deterministic access token, and
// every SQL refusal's HTTP status.
import { createHash, createHmac, randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleCheckout } from '../../supabase/functions/_shared/checkout.ts'
import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import { clientKeyHash } from '../../supabase/functions/_shared/rate-limit.ts'
import type { TurnstileResult } from '../../supabase/functions/_shared/turnstile.ts'

const SITE = 'http://localhost:3000'
const PEPPER = 'unit-test-pepper'

// The database is a recorder: every call's name and arguments, in order.
const recorded: Array<{ fn: string; args: Record<string, unknown> }> = []
let sqlReply: unknown = { ok: true, duplicate: false, order: { orderNumber: 'ABCD2345' } }
const recorderRpc: Rpc = async (fn, args) => {
  recorded.push({ fn, args })
  return sqlReply
}
const verifyOk = async () => ({ ok: true }) as TurnstileResult
const checkoutPost = (request: Request) => handleCheckout(request, { rpc: recorderRpc, verify: verifyOk })

const variantId = randomUUID()

function quoteBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { action: 'quote', lines: [{ variantId, quantity: 1 }], ...overrides }
}

function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'create',
    idempotencyKey: randomUUID(),
    checkoutSession: randomUUID(),
    lines: [{ variantId, quantity: 2 }],
    cityKey: 'riyadh',
    address: 'تبوك شارع الرئيسي',
    couponCode: 'demo10',
    email: 'Guest@Example.com',
    name: 'زائر',
    phone: '0501234567',
    policyRevisions: { store: 1 },
    quoteHash: 'a'.repeat(64),
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    ...overrides,
  }
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://127.0.0.1:54321/functions/v1/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** The arguments of the most recent `checkout_create` call. */
function createArgs(): Record<string, unknown> {
  const call = recorded.findLast((entry) => entry.fn === 'checkout_create')
  if (!call) throw new Error('checkout_create was not called')
  return call.args
}

async function replyOf(response: Response): Promise<{ ok: boolean; error?: { code: string; message: string; fields?: unknown }; data?: unknown }> {
  return (await response.json()) as { ok: boolean; error?: { code: string; message: string; fields?: unknown }; data?: unknown }
}

beforeEach(() => {
  recorded.length = 0
  sqlReply = { ok: true, duplicate: false, order: { orderNumber: 'ABCD2345' } }
  vi.stubEnv('SITE_URL', SITE)
  vi.stubEnv('TOKEN_HASH_PEPPER', PEPPER)
  vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the gates, in contact\'s order', () => {
  it('answers the CORS preflight for the site origin only', async () => {
    const response = await checkoutPost(
      new Request('http://127.0.0.1:54321/functions/v1/checkout', { method: 'OPTIONS', headers: { origin: SITE } }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(SITE)
  })

  it('refuses a method other than POST with 405', async () => {
    const response = await checkoutPost(new Request('http://127.0.0.1:54321/functions/v1/checkout', { method: 'GET', headers: { origin: SITE } }))
    expect(response.status).toBe(405)
    expect((await replyOf(response)).error?.code).toBe('METHOD_NOT_ALLOWED')
  })

  it.each([
    ['a foreign origin', { origin: 'https://evil.test' }],
  ])('refuses %s with 403 before anything is called', async (_label, headers) => {
    const response = await checkoutPost(request(quoteBody(), headers))
    expect(response.status).toBe(403)
    expect(recorded).toHaveLength(0)
  })

  it('refuses a request with no Origin header with 403', async () => {
    const withOrigin = request(quoteBody())
    const headers = new Headers(withOrigin.headers)
    headers.delete('origin')
    const response = await checkoutPost(new Request(withOrigin.url, { method: 'POST', headers, body: await withOrigin.text() }))
    expect(response.status).toBe(403)
    expect(recorded).toHaveLength(0)
  })

  it('refuses a non-JSON content type with 415', async () => {
    const response = await checkoutPost(request('not json', { 'content-type': 'text/plain' }))
    expect(response.status).toBe(415)
  })

  it('refuses unparseable JSON with 400', async () => {
    const response = await checkoutPost(request('{nope'))
    expect(response.status).toBe(400)
    expect((await replyOf(response)).error?.code).toBe('BAD_JSON')
  })

  it('refuses a body over 64 KiB with 413 (no content-length declared)', async () => {
    const response = await checkoutPost(request(quoteBody({ lines: [{ variantId, quantity: 1, dedication: 'x'.repeat(70_000) }] })))
    expect(response.status).toBe(413)
    expect((await replyOf(response)).error?.code).toBe('TOO_LARGE')
    expect(recorded).toHaveLength(0)
  })

  it('refuses a larger declared length before reading the body', async () => {
    const response = await checkoutPost(request(quoteBody(), { 'content-length': '70000' }))
    expect(response.status).toBe(413)
    expect(recorded).toHaveLength(0)
  })

  it.each([
    ['an unknown action', quoteBody({ action: 'pay' })],
    ['a zero quantity', quoteBody({ lines: [{ variantId, quantity: 0 }] })],
    ['a quantity over 20', quoteBody({ lines: [{ variantId, quantity: 21 }] })],
    ['an empty cart', quoteBody({ lines: [] })],
    ['a dedication over 200 characters', quoteBody({ lines: [{ variantId, quantity: 1, dedication: 'x'.repeat(201) }] })],
    ['a malformed variant id', quoteBody({ lines: [{ variantId: 'not-a-uuid', quantity: 1 }] })],
    ['a bad quote hash', createBody({ quoteHash: 'zz' })],
    ['a bad idempotency key', createBody({ idempotencyKey: 'not-a-uuid' })],
    ['a bad email', createBody({ email: 'nope' })],
    ['a missing name', createBody({ name: '' })],
    // The database refuses an address over 500 characters (ADDRESS_REQUIRED); the schema names the field first.
    ['an address over the database limit', createBody({ address: 'ا'.repeat(501) })],
    ['a non-integer policy revision', createBody({ policyRevisions: { store: 'one' } })],
    ['a bad order number', { action: 'cancel', orderNumber: 'ABCD01', accessToken: 'A'.repeat(43) }],
    ['a bad access token', { action: 'cancel', orderNumber: 'ABCD2345', accessToken: 'short' }],
    ['an unknown field', quoteBody({ website: 'x' })],
    // The server prices every create itself; a browser total is refused outright.
    ['a create carrying a browser total', createBody({ total: 1 })],
  ])('refuses %s with 422 and flattened fields', async (_label, body) => {
    const response = await checkoutPost(request(body))
    expect(response.status).toBe(422)
    const reply = await replyOf(response)
    expect(reply.error?.code).toBe('INVALID')
    expect(reply.error?.fields).toBeDefined()
    expect(recorded).toHaveLength(0)
  })

  it.each([
    ['no SITE_URL', { SITE_URL: '' }],
    ['no TOKEN_HASH_PEPPER', { TOKEN_HASH_PEPPER: '' }],
  ])('answers 503 UNAVAILABLE with %s', async (_label, env) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    const response = await checkoutPost(request(quoteBody()))
    expect(response.status).toBe(503)
    expect((await replyOf(response)).error?.code).toBe('UNAVAILABLE')
  })
})

describe('quote', () => {
  it('passes the peppered IP hash and the arguments through, 200 with the quote as data', async () => {
    sqlReply = { ok: true, subtotal: 6900, quoteHash: 'b'.repeat(64) }
    const lines = [{ variantId, quantity: 3 }, { variantId: randomUUID(), quantity: 1, dedication: 'إهداء' }]
    const call = request(quoteBody({ lines, cityKey: 'tabuk', couponCode: 'demo10' }))
    const response = await checkoutPost(call)
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: sqlReply })
    expect(recorded[0]).toMatchObject({ fn: 'checkout_quote' })
    expect(recorded[0]!.args.p_lines).toEqual(lines)
    expect(recorded[0]!.args.p_city_key).toBe('tabuk')
    expect(recorded[0]!.args.p_coupon_code).toBe('demo10')
    expect(recorded[0]!.args.p_ip_hash).toBe(await clientKeyHash(call, PEPPER))
  })

  it('sends null, never undefined, for the absent city and coupon', async () => {
    await checkoutPost(request(quoteBody()))
    expect(recorded[0]!.args.p_city_key).toBeNull()
    expect(recorded[0]!.args.p_coupon_code).toBeNull()
  })

  it('a cart refusal inside the quote is data, not an HTTP error', async () => {
    sqlReply = { ok: false, errors: [{ code: 'OUT_OF_STOCK', line: 1 }] }
    const response = await checkoutPost(request(quoteBody()))
    expect(response.status).toBe(200)
    expect((await replyOf(response)).data).toEqual(sqlReply)
  })
})

describe('create normalization', () => {
  it('lower-cases and punycodes the email, trims the name, and lower-cases the variant id', async () => {
    await checkoutPost(request(createBody({ email: '  User@مثال.السعودية ', lines: [{ variantId: variantId.toUpperCase(), quantity: 1 }] })))
    const args = createArgs()
    expect(args.p_email).toBe('user@xn--mgbh0fb.xn--mgberp4a5d4ar')
    expect(args.p_name).toBe('زائر')
    expect((args.p_lines as Array<{ variantId: string }>)[0]!.variantId).toBe(variantId)
  })

  it.each([
    ['the international form', '966512345678', '966512345678'],
    ['a plus prefix', '+966512345678', '966512345678'],
    ['the local trunk form', '0501234567', '966501234567'],
    ['a bare local number', '512345678', '966512345678'],
    ['separators and Arabic-Indic digits', '٠٥٠-١٢٣٤٥٦٧', '966501234567'],
  ])('normalizes %s of a Saudi mobile', async (_label, typed, stored) => {
    await checkoutPost(request(createBody({ phone: typed })))
    expect(createArgs().p_phone).toBe(stored)
  })

  it('collapses every whitespace run in the address, newlines included', async () => {
    await checkoutPost(request(createBody({ address: '  تبوك\n\n  شارع   الرئيسي,\nالحي  ' })))
    expect(createArgs().p_address).toBe('تبوك شارع الرئيسي, الحي')
  })

  it('upper-cases and trims the coupon code; an absent one is null', async () => {
    await checkoutPost(request(createBody({ couponCode: '  demo10 ' })))
    expect(createArgs().p_coupon_code).toBe('DEMO10')
    await checkoutPost(request(createBody({ couponCode: undefined })))
    expect(createArgs().p_coupon_code).toBeNull()
  })

  it('an empty phone becomes null; a present, invalid one is 422', async () => {
    await checkoutPost(request(createBody({ phone: '  ' })))
    expect(createArgs().p_phone).toBeNull()
    const response = await checkoutPost(request(createBody({ phone: 'not-a-phone' })))
    expect(response.status).toBe(422)
    const reply = await replyOf(response)
    expect(reply.error?.code).toBe('INVALID')
    // The one successful call of this test is the whole database traffic.
    expect(recorded).toHaveLength(1)
  })
})

describe('the request hash', () => {
  async function hashOf(overrides: Record<string, unknown> = {}): Promise<string> {
    await checkoutPost(request(createBody(overrides)))
    return createArgs().p_request_hash as string
  }

  it('is 64 hex characters', async () => {
    expect(await hashOf()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores key order, the idempotency key and the Turnstile token', async () => {
    const body = createBody()
    await checkoutPost(request(body))
    const base = createArgs().p_request_hash as string
    const reordered: Record<string, unknown> = {}
    for (const key of ['quoteHash', 'phone', 'name', 'email', 'couponCode', 'address', 'cityKey', 'lines', 'policyRevisions', 'checkoutSession', 'turnstileToken', 'idempotencyKey', 'action']) {
      reordered[key] = body[key]
    }
    reordered.turnstileToken = 'OTHER.DUMMY.TOKEN.XXXX'
    reordered.idempotencyKey = randomUUID()
    await checkoutPost(request(reordered))
    expect(createArgs().p_request_hash).toBe(base)
  })

  it('differs when any field of the confirmed request changes', async () => {
    const base = await hashOf()
    const changes: Array<[string, unknown]> = [
      ['checkoutSession', randomUUID()],
      ['lines', [{ variantId, quantity: 3 }]],
      ['lines', [{ variantId, quantity: 2, dedication: 'إهداء' }]],
      ['cityKey', 'jeddah'],
      ['cityKey', undefined],
      ['address', 'عنوان آخر أطول قليلًا'],
      ['address', undefined],
      ['couponCode', 'other'],
      ['email', 'other@example.com'],
      ['name', 'اسم آخر'],
      ['phone', '0531234567'],
      ['policyRevisions', { store: 2 }],
      ['quoteHash', 'b'.repeat(64)],
    ]
    for (const [field, value] of changes) {
      expect(await hashOf({ [field]: value }), `${field} = ${String(value)}`).not.toBe(base)
    }
  })
})

describe('the access token', () => {
  function expectedToken(idempotencyKey: string): string {
    return createHmac('sha256', PEPPER).update(`order-access:${idempotencyKey}`).digest('base64url')
  }

  function expectedHash(token: string): string {
    return createHash('sha256').update(`${PEPPER}:order:${token}`).digest('hex')
  }

  it('is deterministic per idempotency key, and its hash is what reaches the rpc', async () => {
    const key = randomUUID()
    const first = await checkoutPost(request(createBody({ idempotencyKey: key })))
    const second = await checkoutPost(request(createBody({ idempotencyKey: key })))
    const token = ((await replyOf(first)).data as { accessToken: string }).accessToken
    expect(((await replyOf(second)).data as { accessToken: string }).accessToken).toBe(token)
    expect(token).toBe(expectedToken(key))
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createArgs().p_access_token_hash).toBe(expectedHash(token))
  })

  it('differs for another idempotency key', async () => {
    const first = ((await replyOf(await checkoutPost(request(createBody())))).data as { accessToken: string }).accessToken
    const second = ((await replyOf(await checkoutPost(request(createBody())))).data as { accessToken: string }).accessToken
    expect(second).not.toBe(first)
  })

  it('a new order answers 201 with the order and the token; a duplicate 200 with the same order', async () => {
    const key = randomUUID()
    const created = await checkoutPost(request(createBody({ idempotencyKey: key })))
    expect(created.status).toBe(201)
    const createdData = (await replyOf(created)).data as { order: unknown; accessToken: string }

    sqlReply = { ok: true, duplicate: true, tokenMatches: true, order: { orderNumber: 'ABCD2345' } }
    const repeated = await checkoutPost(request(createBody({ idempotencyKey: key })))
    expect(repeated.status).toBe(200)
    expect(await replyOf(repeated)).toEqual({ ok: true, data: { order: { orderNumber: 'ABCD2345' }, accessToken: createdData.accessToken } })
  })

  it('a duplicate whose token does not match returns no token', async () => {
    sqlReply = { ok: true, duplicate: true, tokenMatches: false, order: { orderNumber: 'ABCD2345' } }
    const response = await checkoutPost(request(createBody()))
    expect(response.status).toBe(200)
    expect((await replyOf(response)).data).toEqual({ order: { orderNumber: 'ABCD2345' } })
  })
})

describe('Turnstile (create only)', () => {
  it('a missing TURNSTILE_SECRET_KEY is 503 TURNSTILE_UNAVAILABLE', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    const response = await checkoutPost(request(createBody()))
    expect(response.status).toBe(503)
    expect((await replyOf(response)).error?.code).toBe('TURNSTILE_UNAVAILABLE')
    expect(recorded).toHaveLength(0)
  })

  it('asks siteverify for the checkout action, the site hostname and the configured secret', async () => {
    // The widget renders action 'checkout' (CheckoutForm); a drift here would fail every hosted checkout.
    const verify = vi.fn(verifyOk)
    await handleCheckout(request(createBody()), { rpc: recorderRpc, verify })
    expect(verify).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'XXXX.DUMMY.TOKEN.XXXX',
        secret: '1x0000000000000000000000000000000AA',
        expectedAction: 'checkout',
        expectedHostname: new URL(SITE).hostname,
      }),
    )
  })

  it.each([
    ['an unreachable siteverify', { ok: false, code: 'UNREACHABLE' }, 503, 'TURNSTILE_UNAVAILABLE'],
    ['an invalid token', { ok: false, code: 'INVALID_TOKEN' }, 400, 'TURNSTILE'],
    ['an action mismatch', { ok: false, code: 'ACTION_MISMATCH' }, 400, 'TURNSTILE'],
    ['a hostname mismatch', { ok: false, code: 'HOSTNAME_MISMATCH' }, 400, 'TURNSTILE'],
  ])('%s maps like contact', async (_label, verdict, status, code) => {
    const response = await handleCheckout(request(createBody()), {
      rpc: recorderRpc,
      verify: async () => verdict as TurnstileResult,
    })
    expect(response.status).toBe(status)
    expect((await replyOf(response)).error?.code).toBe(code)
    expect(recorded).toHaveLength(0)
  })
})

describe('SQL refusals map to their status', () => {
  it.each([
    ['ACTIVE_HOLD', 409],
    ['IDEMPOTENCY_CONFLICT', 409],
    ['OUT_OF_STOCK', 409],
    ['COUPON_EXHAUSTED', 409],
    ['INVALID_CONTACT', 422],
    ['ADDRESS_REQUIRED', 422],
    ['PHONE_REQUIRED', 422],
    ['INVALID_CART', 422],
    ['EMPTY_CART', 422],
    ['TOO_MANY_LINES', 422],
    ['INVALID_LINE', 422],
    ['INVALID_QUANTITY', 422],
    ['DUPLICATE_LINE', 422],
    ['UNAVAILABLE', 422],
    ['DEDICATION_NOT_ALLOWED', 422],
    ['INVALID_DEDICATION', 422],
    ['CITY_REQUIRED', 422],
    ['CITY_UNSUPPORTED', 422],
    ['COUPON_INVALID', 422],
    ['COUPON_MIN_SUBTOTAL', 422],
    ['COUPON_NOT_APPLICABLE', 422],
    ['CART_TOO_LARGE', 422],
    ['CHECKOUT_DISABLED', 503],
    ['SELLER_NOT_CONFIGURED', 503],
    ['POLICIES_NOT_CONFIGURED', 503],
  ])('%s is %i', async (code, status) => {
    sqlReply = { ok: false, code }
    const response = await checkoutPost(request(createBody()))
    expect(response.status).toBe(status)
    const reply = await replyOf(response)
    expect(reply.error?.code).toBe(code)
    expect(reply.error?.message).not.toContain('—')
  })

  it('QUOTE_CHANGED carries the new quote in fields', async () => {
    sqlReply = { ok: false, code: 'QUOTE_CHANGED', quote: { total: 7100 } }
    const response = await checkoutPost(request(createBody()))
    expect(response.status).toBe(409)
    expect((await replyOf(response)).error?.fields).toEqual({ quote: { total: 7100 } })
  })

  it('POLICY_CHANGED carries the approved revisions in fields', async () => {
    sqlReply = { ok: false, code: 'POLICY_CHANGED', policyRevisions: { store: 2 } }
    const response = await checkoutPost(request(createBody()))
    expect(response.status).toBe(409)
    expect((await replyOf(response)).error?.fields).toEqual({ policyRevisions: { store: 2 } })
  })

  it('a cart refusal carries the quote only when the SQL returned one', async () => {
    sqlReply = { ok: false, code: 'CITY_REQUIRED', quote: { total: 6900 } }
    expect((await replyOf(await checkoutPost(request(createBody())))).error?.fields).toEqual({ quote: { total: 6900 } })
    sqlReply = { ok: false, code: 'CITY_REQUIRED' }
    expect((await replyOf(await checkoutPost(request(createBody())))).error?.fields).toBeUndefined()
  })

  it('an unknown code is a detail-free 500', async () => {
    sqlReply = { ok: false, code: 'SOMETHING_NEW' }
    const response = await checkoutPost(request(createBody()))
    expect(response.status).toBe(500)
    expect(await replyOf(response)).toEqual({ ok: false, error: { code: 'FAILED', message: 'تعذّر إكمال الإجراء.' }, requestId: expect.any(String) })
  })

  it('a null reply is a detail-free 500', async () => {
    sqlReply = null
    const response = await checkoutPost(request(createBody()))
    expect(response.status).toBe(500)
  })
})

describe('database errors', () => {
  it('SQLSTATE 54000 is 429 RATE_LIMITED', async () => {
    const throwing: Rpc = async () => {
      throw Object.assign(new Error('Too many checkouts'), { code: '54000' })
    }
    const response = await handleCheckout(request(createBody()), { rpc: throwing, verify: verifyOk })
    expect(response.status).toBe(429)
    expect((await replyOf(response)).error?.code).toBe('RATE_LIMITED')
  })

  it('any other error is a 500 with no detail', async () => {
    const throwing: Rpc = async () => {
      throw new Error('secret internal detail')
    }
    const response = await handleCheckout(request(createBody()), { rpc: throwing, verify: verifyOk })
    expect(response.status).toBe(500)
    const reply = await replyOf(response)
    expect(reply.error?.code).toBe('FAILED')
    expect(JSON.stringify(reply)).not.toContain('secret internal detail')
  })
})

describe('the environment argument', () => {
  async function environment(): Promise<string> {
    await checkoutPost(request(createBody()))
    return createArgs().p_environment as string
  }

  it("is 'test' unless PAYMENTS_MODE=live on a hosted SITE_URL", async () => {
    expect(await environment()).toBe('test')
    vi.stubEnv('PAYMENTS_MODE', 'live')
    expect(await environment()).toBe('test') // SITE_URL is local
    vi.stubEnv('SITE_URL', 'https://anas.studio')
    const hosted = await handleCheckout(request(createBody(), { origin: 'https://anas.studio' }), {
      rpc: recorderRpc,
      verify: verifyOk,
    })
    expect(hosted.status).toBe(201)
    expect(createArgs().p_environment).toBe('live')
    vi.stubEnv('SITE_URL', SITE)
    vi.stubEnv('PAYMENTS_MODE', 'test')
    expect(await environment()).toBe('test')
  })
})

describe('cancel', () => {
  it('upper-cases the order number, sends the token\'s hash, and answers the status', async () => {
    sqlReply = { ok: true, status: 'cancelled' }
    const token = 'A'.repeat(43)
    const response = await checkoutPost(request({ action: 'cancel', orderNumber: 'abcd2345', accessToken: token }))
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: { status: 'cancelled' } })
    expect(recorded[0]).toMatchObject({ fn: 'checkout_cancel' })
    expect(recorded[0]!.args.p_order_number).toBe('ABCD2345')
    expect(recorded[0]!.args.p_access_token_hash).toBe(createHash('sha256').update(`${PEPPER}:order:${token}`).digest('hex'))
  })

  it('NOT_FOUND is 404', async () => {
    sqlReply = { ok: false, code: 'NOT_FOUND' }
    const response = await checkoutPost(request({ action: 'cancel', orderNumber: 'ABCD2345', accessToken: 'A'.repeat(43) }))
    expect(response.status).toBe(404)
    expect((await replyOf(response)).error?.code).toBe('NOT_FOUND')
  })
})
