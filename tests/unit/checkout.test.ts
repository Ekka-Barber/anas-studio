// P07, P08 round 4: the `checkout` Edge Function's handler with an injected rpc,
// Turnstile verifier, payment settings and Moyasar client — no network, no
// database. The database's own invariants are proven in
// tests/integration/checkout.test.ts and the real function against the emulator
// in tests/integration/checkout-http.test.ts; here the checks are the handler's:
// the gates (origin, method, content type, size, JSON, schema), the
// normalization and hashing rules, the deterministic access token, every SQL
// refusal's HTTP status, the payments and sandbox fence, the invoice step's four
// answers, `pay`, and every branch of `cancel` against the provider.
import { createHash, createHmac, randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type CheckoutDeps, handleCheckout } from '../../supabase/functions/_shared/checkout.ts'
import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import type { PaymentDeps } from '../../supabase/functions/_shared/payments.ts'
import type { MoyasarClient, MoyasarInvoice, MoyasarPayment, MoyasarResult, PaymentsConfigOk } from '../../supabase/functions/_shared/payments/moyasar.ts'
import { clientKeyHash } from '../../supabase/functions/_shared/rate-limit.ts'
import type { TurnstileResult } from '../../supabase/functions/_shared/turnstile.ts'

const SITE = 'http://localhost:3000'
const HOSTED = 'https://anas.studio'
const PEPPER = 'unit-test-pepper'
const SANDBOX_CODE = 'sandbox-access-code-1234'
const ATTEMPT = randomUUID()
const INVOICE_ID = randomUUID()
const PAYMENT_ID = randomUUID()
const INVOICE_URL = `http://127.0.0.1:54390/invoices/${INVOICE_ID}`
const NUMBER = 'ABCD2345'
const TOKEN = 'A'.repeat(43)
const TOTAL = 12_500

const config: PaymentsConfigOk = {
  ok: true,
  baseUrl: 'http://host.docker.internal:54390/v1',
  secretKey: 'sk_test_local_emulator_key_not_for_production',
  webhookSecret: 'local-moyasar-webhook-secret-not-for-production',
  mode: 'test',
  callbackBase: 'http://127.0.0.1:54321/functions/v1',
  storageBase: 'http://127.0.0.1:54321/storage/v1',
}
// A hosted site in test mode: `paymentsConfig()` only accepts it with the sandbox access code.
const hostedTest: PaymentsConfigOk = {
  ...config,
  baseUrl: 'https://api.moyasar.com/v1',
  callbackBase: 'https://abcdefghijklmnop.supabase.co/functions/v1',
  storageBase: 'https://abcdefghijklmnop.supabase.co/storage/v1',
  testAccessCode: SANDBOX_CODE,
}
const hostedLive: PaymentsConfigOk = { ...hostedTest, mode: 'live', secretKey: 'sk_live_hosted_key_value', testAccessCode: undefined }

// The database is a recorder: every call's name and arguments, in order. A reply scripted for a function
// (the last one repeats) wins; every other checkout function answers `sqlReply`.
const recorded: Array<{ fn: string; args: Record<string, unknown> }> = []
let sqlReply: unknown = { ok: true, duplicate: false, order: { orderNumber: NUMBER } }
const script = new Map<string, unknown[]>()
const scripted = (fn: string, ...values: unknown[]): void => void script.set(fn, values)
const recorderRpc: Rpc = async (fn, args) => {
  recorded.push({ fn, args })
  const values = script.get(fn)
  if (!values) return fn.startsWith('checkout_') ? sqlReply : null
  const value = values.length > 1 ? values.shift() : values[0]
  if (value instanceof Error) throw value
  return value
}
const names = (): string[] => recorded.map((entry) => entry.fn)
const calls = (fn: string): Array<Record<string, unknown>> => recorded.filter((entry) => entry.fn === fn).map((entry) => entry.args)
const dbError = (code: string): Error => Object.assign(new Error('detail that must never leave'), { code })

// The Moyasar client is a stub: every call is "unavailable" until a test says otherwise.
const client = {
  createInvoice: vi.fn(),
  fetchInvoice: vi.fn(),
  listInvoices: vi.fn(),
  cancelInvoice: vi.fn(),
  fetchPayment: vi.fn(),
  refundPayment: vi.fn(),
}
const providerCalls = (): number => Object.values(client).reduce((sum, fn) => sum + fn.mock.calls.length, 0)
const unavailable: MoyasarResult<never> = { ok: false, kind: 'unavailable' }
const good = <T>(data: T): MoyasarResult<T> => ({ ok: true, status: 200, data })
const payments: PaymentDeps = { rpc: recorderRpc, client: client as unknown as MoyasarClient, config }
const invoiceOf = (over: Partial<MoyasarInvoice> = {}): MoyasarInvoice => ({
  id: INVOICE_ID,
  status: 'initiated',
  amount: TOTAL,
  currency: 'SAR',
  url: INVOICE_URL,
  expiredAt: '2026-10-02T12:20:00.000Z',
  metadata: {},
  payments: [],
  ...over,
})
const paymentOf = (over: Partial<MoyasarPayment> = {}): MoyasarPayment => ({
  id: PAYMENT_ID,
  status: 'paid',
  amount: TOTAL,
  currency: 'SAR',
  fee: 0,
  refunded: 0,
  invoiceId: INVOICE_ID,
  createdAt: null,
  sourceType: 'creditcard',
  sourceCompany: 'mada',
  ...over,
})

/** What `payment_attempt_begin` answers for an order that already has its invoice. */
const begunPending = {
  ok: true,
  state: 'pending',
  attemptId: ATTEMPT,
  invoiceUrl: INVOICE_URL,
  order: { orderNumber: NUMBER, status: 'pending_payment', total: TOTAL },
}
const begunNew = {
  ok: true,
  state: 'new',
  attemptId: ATTEMPT,
  amount: TOTAL,
  currency: 'SAR',
  expiresAt: '2026-10-02T12:20:00.000Z',
  order: begunPending.order,
}

const verifyOk = async () => ({ ok: true }) as TurnstileResult
/** The handler's dependencies: the recorder, an always-pass Turnstile, working payments on the local emulator. */
const deps = (over: Partial<CheckoutDeps> = {}): CheckoutDeps => ({ rpc: recorderRpc, verify: verifyOk, config, payments, ...over })
const checkoutPost = (request: Request, over: Partial<CheckoutDeps> = {}) => handleCheckout(request, deps(over))

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

const payBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: 'pay',
  orderNumber: NUMBER.toLowerCase(),
  accessToken: TOKEN,
  ...overrides,
})
const cancelBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: 'cancel',
  orderNumber: NUMBER,
  accessToken: TOKEN,
  ...overrides,
})

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://127.0.0.1:54321/functions/v1/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
/** The same request for the hosted site. */
const hostedRequest = (body: unknown): Request => request(body, { origin: HOSTED })

/** The arguments of the most recent `checkout_create` call. */
function createArgs(): Record<string, unknown> {
  const call = recorded.findLast((entry) => entry.fn === 'checkout_create')
  if (!call) throw new Error('checkout_create was not called')
  return call.args
}

type Reply = { ok: boolean; error?: { code: string; message: string; fields?: any }; data?: any }
async function replyOf(response: Response): Promise<Reply> {
  return (await response.json()) as Reply
}

function expectedToken(idempotencyKey: string, version = 0): string {
  return createHmac('sha256', PEPPER)
    .update(version === 0 ? `order-access:${idempotencyKey}` : `order-access:${idempotencyKey}:${version}`)
    .digest('base64url')
}
const hashOf = (token: string): string => createHash('sha256').update(`${PEPPER}:order:${token}`).digest('hex')

beforeEach(() => {
  recorded.length = 0
  script.clear()
  sqlReply = { ok: true, duplicate: false, order: { orderNumber: NUMBER } }
  for (const fn of Object.values(client)) fn.mockReset().mockResolvedValue(unavailable)
  // The invoice step's defaults: the order already has its invoice.
  scripted('payment_attempt_begin', begunPending)
  scripted('payment_attempt_created', { ok: true })
  scripted('payment_attempt_close', { ok: true })
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
    ['an unknown action', quoteBody({ action: 'refund' })],
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
    ['a testAccess over 200 characters', quoteBody({ testAccess: 'x'.repeat(201) })],
    ['a testAccess that is not a string', createBody({ testAccess: 5 })],
    ['a pay with a bad order number', payBody({ orderNumber: 'ABCD01' })],
    ['a pay with a bad access token', payBody({ accessToken: 'short' })],
    ['a pay with no token', { action: 'pay', orderNumber: NUMBER }],
    ['a pay with an unknown field', payBody({ lines: [] })],
    ['a cancel carrying testAccess', cancelBody({ testAccess: 'x' })],
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
  it('passes the peppered IP hash and the arguments through, 200 with the quote as data and the test-mode flag', async () => {
    sqlReply = { ok: true, subtotal: 6900, quoteHash: 'b'.repeat(64), checkoutEnabled: true, policyRevisions: { store: 1 } }
    const lines = [{ variantId, quantity: 3 }, { variantId: randomUUID(), quantity: 1, dedication: 'إهداء' }]
    const call = request(quoteBody({ lines, cityKey: 'tabuk', couponCode: 'demo10' }))
    const response = await checkoutPost(call)
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: { ...(sqlReply as object), checkoutEnabled: true, testMode: true } })
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
    sqlReply = { ok: false, errors: [{ code: 'OUT_OF_STOCK', line: 1, held: true }] }
    const response = await checkoutPost(request(quoteBody()))
    expect(response.status).toBe(200)
    expect((await replyOf(response)).data).toEqual({ ...(sqlReply as object), checkoutEnabled: false, testMode: true })
  })

  it('never opens what the database says is closed', async () => {
    sqlReply = { ok: true, checkoutEnabled: false }
    expect((await replyOf(await checkoutPost(request(quoteBody())))).data.checkoutEnabled).toBe(false)
    // Only a boolean true opens it: a missing or odd value is closed.
    for (const odd of [undefined, 'true', 1, null]) {
      sqlReply = { ok: true, checkoutEnabled: odd }
      expect((await replyOf(await checkoutPost(request(quoteBody())))).data.checkoutEnabled, String(odd)).toBe(false)
    }
  })

  it('while payments are not configured it is closed and not in test mode, though the cart is still priced', async () => {
    sqlReply = { ok: true, subtotal: 6900, checkoutEnabled: true }
    const response = await checkoutPost(request(quoteBody()), { config: { ok: false, reason: 'NOT_CONFIGURED' }, payments: null })
    expect(response.status).toBe(200)
    expect((await replyOf(response)).data).toEqual({ ok: true, subtotal: 6900, checkoutEnabled: false, testMode: false })
    expect(names()).toEqual(['checkout_quote'])
  })

  it('testMode follows the configured mode, not the environment', async () => {
    sqlReply = { ok: true, checkoutEnabled: true }
    vi.stubEnv('PAYMENTS_MODE', 'live')
    expect((await replyOf(await checkoutPost(request(quoteBody())))).data.testMode).toBe(true)
    vi.stubEnv('SITE_URL', HOSTED)
    const live = await checkoutPost(hostedRequest(quoteBody()), { config: hostedLive })
    expect((await replyOf(live)).data).toMatchObject({ checkoutEnabled: true, testMode: false })
  })
})

describe('the sandbox fence (a hosted site in test mode)', () => {
  const hosted = (over: Partial<CheckoutDeps> = {}): Partial<CheckoutDeps> => ({
    config: hostedTest,
    payments: { ...payments, config: hostedTest },
    ...over,
  })
  beforeEach(() => {
    vi.stubEnv('SITE_URL', HOSTED)
    sqlReply = { ok: true, checkoutEnabled: true }
  })

  it('quote is closed without the code, with a wrong one and with a near miss; open with the right one', async () => {
    for (const testAccess of [undefined, '', 'wrong', SANDBOX_CODE.slice(0, -1), `${SANDBOX_CODE}x`, SANDBOX_CODE.toUpperCase()]) {
      const data = (await replyOf(await checkoutPost(hostedRequest(quoteBody({ testAccess })), hosted()))).data
      expect(data, String(testAccess)).toMatchObject({ checkoutEnabled: false, testMode: true })
    }
    const open = (await replyOf(await checkoutPost(hostedRequest(quoteBody({ testAccess: SANDBOX_CODE })), hosted()))).data
    expect(open).toMatchObject({ checkoutEnabled: true, testMode: true })
  })

  it('create and pay answer 503 CHECKOUT_DISABLED without the code or with a wrong one, before any database call', async () => {
    for (const testAccess of [undefined, 'wrong']) {
      for (const body of [createBody({ testAccess }), payBody({ testAccess })]) {
        const response = await checkoutPost(hostedRequest(body), hosted({ verify: vi.fn(verifyOk) }))
        expect(response.status).toBe(503)
        expect((await replyOf(response)).error?.code).toBe('CHECKOUT_DISABLED')
      }
    }
    expect(recorded).toHaveLength(0)
    expect(providerCalls()).toBe(0)
  })

  it('create and pay go through with the right code, which never reaches the database', async () => {
    sqlReply = { ok: true, duplicate: false, order: { orderNumber: NUMBER } }
    expect((await checkoutPost(hostedRequest(createBody({ testAccess: SANDBOX_CODE })), hosted())).status).toBe(201)
    expect((await checkoutPost(hostedRequest(payBody({ testAccess: SANDBOX_CODE })), hosted())).status).toBe(200)
    expect(names()).toEqual(['checkout_create', 'payment_attempt_begin', 'payment_attempt_begin'])
    expect(JSON.stringify(recorded)).not.toContain(SANDBOX_CODE)
  })

  it('the code is checked before Turnstile, so a closed sandbox costs no siteverify call', async () => {
    const verify = vi.fn(verifyOk)
    await checkoutPost(hostedRequest(createBody()), hosted({ verify }))
    expect(verify).not.toHaveBeenCalled()
  })

  it('a hosted site in live mode has no fence; a local site in test mode needs no code', async () => {
    const live = await checkoutPost(hostedRequest(createBody()), { config: hostedLive, payments: { ...payments, config: hostedLive } })
    expect(live.status).toBe(201)
    vi.stubEnv('SITE_URL', SITE)
    expect((await checkoutPost(request(createBody()))).status).toBe(201)
    expect((await checkoutPost(request(payBody()))).status).toBe(200)
    expect((await replyOf(await checkoutPost(request(quoteBody())))).data.checkoutEnabled).toBe(true)
  })

  it('a configuration without a code on a hosted site in test mode stays closed (it cannot be, but the answer is never open)', async () => {
    const noCode = { ...hostedTest, testAccessCode: undefined }
    expect((await replyOf(await checkoutPost(hostedRequest(quoteBody({ testAccess: 'x' })), { config: noCode }))).data.checkoutEnabled).toBe(false)
    expect((await checkoutPost(hostedRequest(createBody({ testAccess: 'x' })), { config: noCode, payments: { ...payments, config: noCode } })).status).toBe(503)
  })
})

describe('payments not configured', () => {
  const unconfigured: Partial<CheckoutDeps> = { config: { ok: false, reason: 'NOT_CONFIGURED' }, payments: null }

  it('create answers 503 CHECKOUT_DISABLED before Turnstile and before any database call', async () => {
    const verify = vi.fn(verifyOk)
    const response = await checkoutPost(request(createBody()), { ...unconfigured, verify })
    expect(response.status).toBe(503)
    const reply = await replyOf(response)
    expect(reply.error).toEqual({ code: 'CHECKOUT_DISABLED', message: 'الشراء غير متاح حاليًا، ويفتح قريبًا.' })
    expect(verify).not.toHaveBeenCalled()
    expect(recorded).toHaveLength(0)
  })

  it('pay answers the same, with nothing called', async () => {
    const response = await checkoutPost(request(payBody()), unconfigured)
    expect(response.status).toBe(503)
    expect((await replyOf(response)).error?.code).toBe('CHECKOUT_DISABLED')
    expect(recorded).toHaveLength(0)
    expect(providerCalls()).toBe(0)
  })

  it('a malformed body is still refused as malformed (422), not as closed', async () => {
    expect((await checkoutPost(request(createBody({ quoteHash: 'zz' })), unconfigured)).status).toBe(422)
  })

  it('one configured but with no payment dependencies (a null) is closed too', async () => {
    expect((await checkoutPost(request(createBody()), { payments: null })).status).toBe(503)
  })

  it('cancel still releases an order that has no attempt, and answers PAYMENT_ACTIVE for one that has', async () => {
    sqlReply = { ok: true, status: 'cancelled' }
    expect((await checkoutPost(request(cancelBody()), unconfigured)).status).toBe(200)
    scripted('checkout_cancel', { ok: false, code: 'PAYMENT_ACTIVE', attempt: { attemptId: ATTEMPT, status: 'pending', providerInvoiceId: INVOICE_ID } })
    const busy = await checkoutPost(request(cancelBody()), unconfigured)
    expect(busy.status).toBe(409)
    expect((await replyOf(busy)).error).toEqual({ code: 'PAYMENT_ACTIVE', message: 'الدفع قيد المعالجة؛ حاول بعد لحظات.' })
    expect(names()).toEqual(['checkout_cancel', 'checkout_cancel'])
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
    // The one successful create of this test is the only one that reached the database.
    expect(calls('checkout_create')).toHaveLength(1)
  })
})

describe('the name (I48 item 5)', () => {
  it.each([
    ['a bell', 'زا\u0007ئر'],
    ['a newline inside', 'زائر\nآخر'],
    ['a tab inside', 'زائر\tآخر'],
    ['a DEL', 'زائر\u007F'],
    ['a C1 control (NEL)', 'زائر\u0085آخر'],
    ['a null byte', 'زائر\u0000'],
  ])('refuses %s with the field named, before anything is called', async (_label, name) => {
    const response = await checkoutPost(request(createBody({ name })))
    expect(response.status).toBe(422)
    const reply = await replyOf(response)
    expect(reply.error?.code).toBe('INVALID')
    // The form shows the message under the name.
    expect(reply.error?.fields.fieldErrors.name).toEqual(['لا يُقبل اسم فيه رموز تحكم.'])
    expect(recorded).toHaveLength(0)
  })

  it('a newline around the name is only whitespace: trimmed, accepted', async () => {
    const response = await checkoutPost(request(createBody({ name: '\n  زائر كريم \t' })))
    expect(response.status).toBe(201)
    expect(createArgs().p_name).toBe('زائر كريم')
  })
})

describe('the request hash', () => {
  async function requestHashOf(overrides: Record<string, unknown> = {}): Promise<string> {
    await checkoutPost(request(createBody(overrides)))
    return createArgs().p_request_hash as string
  }

  it('is 64 hex characters', async () => {
    expect(await requestHashOf()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores key order, the idempotency key, the Turnstile token and the sandbox code', async () => {
    const body = createBody()
    await checkoutPost(request(body))
    const base = createArgs().p_request_hash as string
    const reordered: Record<string, unknown> = {}
    for (const key of ['quoteHash', 'phone', 'name', 'email', 'couponCode', 'address', 'cityKey', 'lines', 'policyRevisions', 'checkoutSession', 'turnstileToken', 'idempotencyKey', 'action']) {
      reordered[key] = body[key]
    }
    reordered.turnstileToken = 'OTHER.DUMMY.TOKEN.XXXX'
    reordered.idempotencyKey = randomUUID()
    reordered.testAccess = 'anything'
    await checkoutPost(request(reordered))
    expect(createArgs().p_request_hash).toBe(base)
  })

  it('differs when any field of the confirmed request changes', async () => {
    const base = await requestHashOf()
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
      expect(await requestHashOf({ [field]: value }), `${field} = ${String(value)}`).not.toBe(base)
    }
  })
})

describe('the access token', () => {
  it('is deterministic per idempotency key, and its hash is what reaches the rpc', async () => {
    const key = randomUUID()
    const first = await checkoutPost(request(createBody({ idempotencyKey: key })))
    const second = await checkoutPost(request(createBody({ idempotencyKey: key })))
    const token = ((await replyOf(first)).data as { accessToken: string }).accessToken
    expect(((await replyOf(second)).data as { accessToken: string }).accessToken).toBe(token)
    expect(token).toBe(expectedToken(key))
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createArgs().p_access_token_hash).toBe(hashOf(token))
  })

  it('differs for another idempotency key', async () => {
    const first = ((await replyOf(await checkoutPost(request(createBody())))).data as { accessToken: string }).accessToken
    const second = ((await replyOf(await checkoutPost(request(createBody())))).data as { accessToken: string }).accessToken
    expect(second).not.toBe(first)
  })

  it('a new order answers 201 with the order, the token and the payment; a duplicate that is no longer pending 200 without it', async () => {
    const key = randomUUID()
    const created = await checkoutPost(request(createBody({ idempotencyKey: key })))
    expect(created.status).toBe(201)
    const createdData = (await replyOf(created)).data as { order: unknown; accessToken: string; payment: unknown }
    expect(createdData.payment).toEqual({ state: 'ready', url: INVOICE_URL })

    sqlReply = { ok: true, duplicate: true, tokenMatches: true, order: { orderNumber: NUMBER, status: 'paid' } }
    recorded.length = 0
    const repeated = await checkoutPost(request(createBody({ idempotencyKey: key })))
    expect(repeated.status).toBe(200)
    expect(await replyOf(repeated)).toEqual({ ok: true, data: { order: { orderNumber: NUMBER, status: 'paid' }, accessToken: createdData.accessToken } })
    expect(names()).toEqual(['checkout_create'])
  })

  it('a duplicate whose token does not match returns no token and no payment', async () => {
    sqlReply = { ok: true, duplicate: true, tokenMatches: false, order: { orderNumber: NUMBER, status: 'pending_payment' } }
    const response = await checkoutPost(request(createBody()))
    expect(response.status).toBe(200)
    expect((await replyOf(response)).data).toEqual({ order: { orderNumber: NUMBER, status: 'pending_payment' } })
    expect(names()).toEqual(['checkout_create'])
  })
})

describe('create: the invoice step', () => {
  const paymentOfCreate = async (over: Partial<CheckoutDeps> = {}) => {
    const response = await checkoutPost(request(createBody()), over)
    return { response, reply: await replyOf(response) }
  }

  it('a new order whose invoice exists answers ready with its URL, and begins as create does: the order\'s own token, no caller hash, the configured mode', async () => {
    const key = randomUUID()
    const response = await checkoutPost(request(createBody({ idempotencyKey: key })))
    expect(response.status).toBe(201)
    const reply = await replyOf(response)
    expect(reply.data).toEqual({
      order: begunPending.order,
      accessToken: expectedToken(key),
      payment: { state: 'ready', url: INVOICE_URL },
    })
    expect(names()).toEqual(['checkout_create', 'payment_attempt_begin'])
    expect(calls('payment_attempt_begin')[0]).toEqual({
      p_order_number: NUMBER,
      p_access_token_hash: hashOf(expectedToken(key)),
      p_mode: 'test',
      p_ip_hash: null,
    })
    expect(providerCalls()).toBe(0)
  })

  it('a new attempt makes the invoice: the order number and attempt id only, the callback and return URLs, the hold\'s end', async () => {
    scripted('payment_attempt_begin', begunNew)
    client.createInvoice.mockResolvedValue(good(invoiceOf()))
    const { response, reply } = await paymentOfCreate()
    expect(response.status).toBe(201)
    expect(reply.data.payment).toEqual({ state: 'ready', url: INVOICE_URL })
    expect(client.createInvoice).toHaveBeenCalledTimes(1)
    expect(client.createInvoice).toHaveBeenCalledWith({
      amount: TOTAL,
      currency: 'SAR',
      description: `طلب ${NUMBER}`,
      callback_url: 'http://127.0.0.1:54321/functions/v1/payments/callback',
      success_url: `${SITE}/checkout/return?order=${NUMBER}`,
      back_url: `${SITE}/checkout/return?order=${NUMBER}`,
      expired_at: '2026-10-02T12:20:00.000Z',
      metadata: { order_number: NUMBER, attempt_id: ATTEMPT },
    })
    expect(calls('payment_attempt_created')[0]).toMatchObject({ p_attempt: ATTEMPT, p_invoice_id: INVOICE_ID, p_invoice_url: INVOICE_URL })
    // Nothing about the buyer reaches the provider.
    expect(JSON.stringify(client.createInvoice.mock.calls)).not.toMatch(/example\.com|زائر|تبوك|966501234567/)
  })

  it.each([
    ['another request is creating it', { ok: true, state: 'creating', attemptId: ATTEMPT, order: begunPending.order }, { state: 'preparing' }],
    [
      'the begin refused with the hold about to end',
      { ok: false, code: 'HOLD_EXPIRED', order: begunPending.order },
      { state: 'closed', code: 'HOLD_EXPIRED' },
    ],
    [
      'the begin refused: too many attempts',
      { ok: false, code: 'TOO_MANY_ATTEMPTS', order: begunPending.order },
      { state: 'closed', code: 'TOO_MANY_ATTEMPTS' },
    ],
    [
      'the begin refused: the order is not payable',
      { ok: false, code: 'ORDER_NOT_PAYABLE', status: 'cancelled', reason: 'NOT_PENDING', order: begunPending.order },
      { state: 'closed', code: 'ORDER_NOT_PAYABLE', status: 'cancelled', reason: 'NOT_PENDING' },
    ],
  ])('%s: the order exists and the payment is %j', async (_label, begun, payment) => {
    scripted('payment_attempt_begin', begun)
    const { response, reply } = await paymentOfCreate()
    expect(response.status).toBe(201)
    expect(reply.data.payment).toEqual(payment)
    expect(reply.data.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(providerCalls()).toBe(0)
  })

  it('the provider refusing the invoice, or answering 429, is unavailable; the attempt is closed failed', async () => {
    scripted('payment_attempt_begin', begunNew)
    for (const kind of ['refused', 'rate_limited'] as const) {
      recorded.length = 0
      client.createInvoice.mockResolvedValue({ ok: false, kind })
      const { response, reply } = await paymentOfCreate()
      expect(response.status, kind).toBe(201)
      expect(reply.data.payment, kind).toEqual({ state: 'unavailable' })
      expect(calls('payment_attempt_close')[0], kind).toMatchObject({ p_attempt: ATTEMPT, p_status: 'failed' })
    }
  })

  it('a creation whose outcome is unknown (a timeout, a 5xx) is preparing; the attempt is closed uncertain and no second invoice is made', async () => {
    scripted('payment_attempt_begin', begunNew)
    client.createInvoice.mockResolvedValue({ ok: false, kind: 'uncertain' })
    const { response, reply } = await paymentOfCreate()
    expect(response.status).toBe(201)
    expect(reply.data.payment).toEqual({ state: 'preparing' })
    expect(calls('payment_attempt_close')[0]).toMatchObject({ p_attempt: ATTEMPT, p_status: 'uncertain' })
    expect(client.createInvoice).toHaveBeenCalledTimes(1)
  })

  it('an uncertain attempt is resolved by listing: one match is adopted', async () => {
    const match = invoiceOf({ metadata: { order_number: NUMBER, attempt_id: ATTEMPT } })
    scripted('payment_attempt_begin', { ok: true, state: 'uncertain', attemptId: ATTEMPT, createdAt: new Date(Date.now() - 600_000).toISOString(), amount: TOTAL, currency: 'SAR', order: begunPending.order })
    client.listInvoices.mockResolvedValue(good({ invoices: [match], nextPage: null }))
    const { reply } = await paymentOfCreate()
    expect(reply.data.payment).toEqual({ state: 'ready', url: INVOICE_URL })
    expect(client.createInvoice).not.toHaveBeenCalled()
  })

  it('when the invoice step throws, the order still exists: preparing, the token and the order come back, and the page retries with pay', async () => {
    const key = randomUUID()
    scripted('payment_attempt_begin', dbError('08006'))
    const response = await checkoutPost(request(createBody({ idempotencyKey: key })))
    expect(response.status).toBe(201)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({
      ok: true,
      data: { order: { orderNumber: NUMBER }, accessToken: expectedToken(key), payment: { state: 'preparing' } },
    })
    expect(text).not.toContain('detail that must never leave')
  })

  it('a begin that cannot find the order (it cannot, right after create) and one that throws a throttle are preparing too', async () => {
    scripted('payment_attempt_begin', { ok: false, code: 'NOT_FOUND' })
    expect((await paymentOfCreate()).reply.data.payment).toEqual({ state: 'preparing' })
    scripted('payment_attempt_begin', dbError('54000'))
    expect((await paymentOfCreate()).reply.data.payment).toEqual({ state: 'preparing' })
  })

  it('a created order the SQL gives no number for is left to pay: preparing, and nothing is begun', async () => {
    sqlReply = { ok: true, duplicate: false, order: {} }
    const { response, reply } = await paymentOfCreate()
    expect(response.status).toBe(201)
    expect(reply.data.payment).toEqual({ state: 'preparing' })
    expect(names()).toEqual(['checkout_create'])
  })

  it('an invoice created but not stored (the ledger refuses it) is cancelled and never handed out: preparing', async () => {
    scripted('payment_attempt_begin', begunNew)
    scripted('payment_attempt_created', { ok: false, code: 'ATTEMPT_CLOSED' })
    client.createInvoice.mockResolvedValue(good(invoiceOf()))
    client.cancelInvoice.mockResolvedValue(good(invoiceOf({ status: 'canceled' })))
    const { reply } = await paymentOfCreate()
    expect(reply.data.payment).toEqual({ state: 'preparing' })
    expect(client.cancelInvoice).toHaveBeenCalledWith(INVOICE_ID)
    expect(JSON.stringify(reply)).not.toContain(INVOICE_URL)
  })

  describe('a repeated request (the same idempotency key)', () => {
    it('whose order still waits for its payment, with the right token, goes through the invoice step again: 200 with the payment', async () => {
      const key = randomUUID()
      sqlReply = { ok: true, duplicate: true, tokenMatches: true, order: { orderNumber: NUMBER, status: 'pending_payment' } }
      const response = await checkoutPost(request(createBody({ idempotencyKey: key })))
      expect(response.status).toBe(200)
      expect((await replyOf(response)).data).toEqual({
        order: begunPending.order,
        accessToken: expectedToken(key),
        payment: { state: 'ready', url: INVOICE_URL },
      })
      expect(names()).toEqual(['checkout_create', 'payment_attempt_begin'])
    })

    it.each(['paid', 'paid_needs_resolution', 'refunded', 'cancelled', 'expired'])('whose order is %s answers as it always did, with no payment', async (status) => {
      const key = randomUUID()
      sqlReply = { ok: true, duplicate: true, tokenMatches: true, order: { orderNumber: NUMBER, status } }
      const response = await checkoutPost(request(createBody({ idempotencyKey: key })))
      expect(response.status).toBe(200)
      expect((await replyOf(response)).data).toEqual({ order: { orderNumber: NUMBER, status }, accessToken: expectedToken(key) })
      expect(names()).toEqual(['checkout_create'])
    })
  })
})

describe('ACTIVE_HOLD (I48 item 3)', () => {
  it('for another buyer: 409 with only when the hold ends', async () => {
    sqlReply = { ok: false, code: 'ACTIVE_HOLD', holdExpiresAt: '2026-10-02T12:20:00.000Z' }
    const response = await checkoutPost(request(createBody()))
    expect(response.status).toBe(409)
    const reply = await replyOf(response)
    expect(reply.error).toEqual({
      code: 'ACTIVE_HOLD',
      message: 'لديك طلب قيد الانتظار؛ أكمله أو ألغه أولًا.',
      fields: { holdExpiresAt: '2026-10-02T12:20:00.000Z' },
    })
    expect(names()).toEqual(['checkout_create'])
    expect(JSON.stringify(reply)).not.toMatch(/accessToken|idempotencyKey/)
  })

  it('for the buyer whose order it is: the order and its token, derived with the version the SQL returned', async () => {
    const held = randomUUID()
    for (const version of [0, 1, 4]) {
      sqlReply = {
        ok: false,
        code: 'ACTIVE_HOLD',
        holdExpiresAt: '2026-10-02T12:20:00.000Z',
        order: { orderNumber: NUMBER, status: 'pending_payment' },
        idempotencyKey: held,
        tokenVersion: version,
      }
      const response = await checkoutPost(request(createBody()))
      expect(response.status).toBe(409)
      const reply = await replyOf(response)
      expect(reply.error?.code).toBe('ACTIVE_HOLD')
      expect(reply.error?.fields).toEqual({
        holdExpiresAt: '2026-10-02T12:20:00.000Z',
        order: { orderNumber: NUMBER, status: 'pending_payment' },
        accessToken: expectedToken(held, version),
      })
    }
    // A later version is another token: the link a recovery replaced is not handed out again.
    expect(expectedToken(held, 1)).not.toBe(expectedToken(held, 0))
  })

  it('a reply with an order but no key or version never invents a token', async () => {
    sqlReply = { ok: false, code: 'ACTIVE_HOLD', holdExpiresAt: '2026-10-02T12:20:00.000Z', order: { orderNumber: NUMBER } }
    const reply = await replyOf(await checkoutPost(request(createBody())))
    expect(reply.error?.fields).toEqual({ holdExpiresAt: '2026-10-02T12:20:00.000Z' })
  })

  it('makes no invoice and calls no provider (the page calls pay)', async () => {
    sqlReply = { ok: false, code: 'ACTIVE_HOLD', holdExpiresAt: '2026-10-02T12:20:00.000Z' }
    await checkoutPost(request(createBody()))
    expect(providerCalls()).toBe(0)
    expect(calls('payment_attempt_begin')).toHaveLength(0)
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
    await checkoutPost(request(createBody()), { verify })
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

  it('pay and cancel need no Turnstile (the access token is the proof)', async () => {
    const verify = vi.fn(verifyOk)
    await checkoutPost(request(payBody()), { verify })
    sqlReply = { ok: true, status: 'cancelled' }
    await checkoutPost(request(cancelBody()), { verify })
    expect(verify).not.toHaveBeenCalled()
  })

  it.each([
    ['an unreachable siteverify', { ok: false, code: 'UNREACHABLE' }, 503, 'TURNSTILE_UNAVAILABLE'],
    ['a siteverify that refused our secret', { ok: false, code: 'MISCONFIGURED' }, 503, 'TURNSTILE_UNAVAILABLE'],
    ['a test secret on a hosted site', { ok: false, code: 'TEST_SECRET_IN_PRODUCTION' }, 503, 'TURNSTILE_UNAVAILABLE'],
    ['an invalid token', { ok: false, code: 'INVALID_TOKEN' }, 400, 'TURNSTILE'],
    ['an action mismatch', { ok: false, code: 'ACTION_MISMATCH' }, 400, 'TURNSTILE'],
    ['a hostname mismatch', { ok: false, code: 'HOSTNAME_MISMATCH' }, 400, 'TURNSTILE'],
  ])('%s maps like contact', async (_label, verdict, status, code) => {
    const response = await checkoutPost(request(createBody()), { verify: async () => verdict as TurnstileResult })
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
    ['TOTAL_BELOW_MINIMUM', 422],
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
    // A refusal is the end: no invoice step.
    expect(names()).toEqual(['checkout_create'])
  })

  it('TOTAL_BELOW_MINIMUM says so in Arabic and carries the quote', async () => {
    const quote = { total: 0, errors: [{ code: 'TOTAL_BELOW_MINIMUM', minimum: 100 }] }
    sqlReply = { ok: false, code: 'TOTAL_BELOW_MINIMUM', quote }
    const reply = await replyOf(await checkoutPost(request(createBody())))
    expect(reply.error).toMatchObject({ code: 'TOTAL_BELOW_MINIMUM', message: 'قيمة الطلب أقل من الحد الأدنى للدفع.' })
    expect(reply.error?.fields).toEqual({ quote })
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
  const throwing = (code?: string): Rpc => async () => {
    throw Object.assign(new Error('secret internal detail'), code ? { code } : {})
  }

  it('SQLSTATE 54000 is 429 RATE_LIMITED', async () => {
    const response = await checkoutPost(request(createBody()), { rpc: throwing('54000') })
    expect(response.status).toBe(429)
    expect((await replyOf(response)).error?.code).toBe('RATE_LIMITED')
  })

  it('any other error is a 500 with no detail', async () => {
    const response = await checkoutPost(request(createBody()), { rpc: throwing() })
    expect(response.status).toBe(500)
    const reply = await replyOf(response)
    expect(reply.error?.code).toBe('FAILED')
    expect(JSON.stringify(reply)).not.toContain('secret internal detail')
  })
})

describe('the environment argument', () => {
  it('is the configured mode, and the function no longer reads PAYMENTS_MODE', async () => {
    await checkoutPost(request(createBody()))
    expect(createArgs().p_environment).toBe('test')
    // The environment says live, the configuration says test: the configuration wins.
    vi.stubEnv('PAYMENTS_MODE', 'live')
    await checkoutPost(request(createBody()))
    expect(createArgs().p_environment).toBe('test')
    vi.stubEnv('PAYMENTS_MODE', 'test')
    vi.stubEnv('SITE_URL', HOSTED)
    const hosted = await checkoutPost(hostedRequest(createBody()), { config: hostedLive, payments: { ...payments, config: hostedLive } })
    expect(hosted.status).toBe(201)
    expect(createArgs().p_environment).toBe('live')
    expect(calls('payment_attempt_begin').at(-1)).toMatchObject({ p_mode: 'live' })
  })
})

describe('pay', () => {
  it('begins the order\'s attempt with the token\'s hash and the caller\'s IP hash, and answers the order and the payment', async () => {
    const call = request(payBody())
    const response = await checkoutPost(call)
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: { order: begunPending.order, payment: { state: 'ready', url: INVOICE_URL } } })
    expect(names()).toEqual(['payment_attempt_begin'])
    expect(calls('payment_attempt_begin')[0]).toEqual({
      p_order_number: NUMBER,
      p_access_token_hash: hashOf(TOKEN),
      p_mode: 'test',
      p_ip_hash: await clientKeyHash(call, PEPPER),
    })
  })

  it('makes the invoice when there is none yet, and never answers an accessToken (the caller holds it)', async () => {
    scripted('payment_attempt_begin', begunNew)
    client.createInvoice.mockResolvedValue(good(invoiceOf()))
    const response = await checkoutPost(request(payBody()))
    expect(response.status).toBe(200)
    const reply = await replyOf(response)
    expect(reply.data.payment).toEqual({ state: 'ready', url: INVOICE_URL })
    expect(JSON.stringify(reply)).not.toContain(TOKEN)
  })

  it('answers each state of the invoice step with 200', async () => {
    const cases: Array<[unknown, unknown]> = [
      [{ ok: true, state: 'creating', attemptId: ATTEMPT, order: begunPending.order }, { state: 'preparing' }],
      [{ ok: false, code: 'HOLD_EXPIRED', order: begunPending.order }, { state: 'closed', code: 'HOLD_EXPIRED' }],
      [{ ok: false, code: 'TOO_MANY_ATTEMPTS', order: begunPending.order }, { state: 'closed', code: 'TOO_MANY_ATTEMPTS' }],
      [{ ok: false, code: 'TOTAL_BELOW_MINIMUM', order: begunPending.order }, { state: 'closed', code: 'TOTAL_BELOW_MINIMUM' }],
      [
        { ok: false, code: 'ORDER_NOT_PAYABLE', status: 'expired', reason: 'NOT_PENDING', order: begunPending.order },
        { state: 'closed', code: 'ORDER_NOT_PAYABLE', status: 'expired', reason: 'NOT_PENDING' },
      ],
    ]
    for (const [begun, payment] of cases) {
      scripted('payment_attempt_begin', begun)
      const response = await checkoutPost(request(payBody()))
      expect(response.status).toBe(200)
      expect(await replyOf(response)).toEqual({ ok: true, data: { order: begunPending.order, payment } })
    }
    scripted('payment_attempt_begin', begunNew)
    client.createInvoice.mockResolvedValue({ ok: false, kind: 'refused' })
    expect((await replyOf(await checkoutPost(request(payBody())))).data.payment).toEqual({ state: 'unavailable' })
  })

  it('an unknown order or a wrong token is 404 NOT_FOUND', async () => {
    scripted('payment_attempt_begin', { ok: false, code: 'NOT_FOUND' })
    const response = await checkoutPost(request(payBody()))
    expect(response.status).toBe(404)
    expect((await replyOf(response)).error).toEqual({ code: 'NOT_FOUND', message: 'لم نجد هذا الطلب.' })
    expect(providerCalls()).toBe(0)
  })

  it('the SQL throttle is 429 RATE_LIMITED', async () => {
    scripted('payment_attempt_begin', dbError('54000'))
    const response = await checkoutPost(request(payBody()))
    expect(response.status).toBe(429)
    expect((await replyOf(response)).error?.code).toBe('RATE_LIMITED')
  })

  it('any other failure is a detail-free 500', async () => {
    scripted('payment_attempt_begin', dbError('08006'))
    const response = await checkoutPost(request(payBody()))
    expect(response.status).toBe(500)
    expect(JSON.stringify(await replyOf(response))).not.toContain('detail that must never leave')
  })
})

describe('cancel', () => {
  const active = (status: string, over: Record<string, unknown> = {}) => ({
    ok: false,
    code: 'PAYMENT_ACTIVE',
    attempt: { attemptId: ATTEMPT, status, providerInvoiceId: INVOICE_ID, ...over },
  })
  const cancelled = { ok: true, status: 'cancelled' }
  const busy = async (response: Response): Promise<void> => {
    expect(response.status).toBe(409)
    expect((await replyOf(response)).error).toEqual({ code: 'PAYMENT_ACTIVE', message: 'الدفع قيد المعالجة؛ حاول بعد لحظات.' })
  }

  it('upper-cases the order number, sends the token\'s hash, and answers the status', async () => {
    sqlReply = { ok: true, status: 'cancelled' }
    const response = await checkoutPost(request({ action: 'cancel', orderNumber: 'abcd2345', accessToken: TOKEN }))
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: { status: 'cancelled' } })
    expect(recorded[0]).toMatchObject({ fn: 'checkout_cancel' })
    expect(recorded[0]!.args.p_order_number).toBe(NUMBER)
    expect(recorded[0]!.args.p_access_token_hash).toBe(hashOf(TOKEN))
    expect(providerCalls()).toBe(0)
  })

  it('an order that is no longer pending answers its status as it always did', async () => {
    sqlReply = { ok: true, status: 'paid' }
    expect(await replyOf(await checkoutPost(request(cancelBody())))).toEqual({ ok: true, data: { status: 'paid' } })
  })

  it('NOT_FOUND is 404', async () => {
    sqlReply = { ok: false, code: 'NOT_FOUND' }
    const response = await checkoutPost(request(cancelBody()))
    expect(response.status).toBe(404)
    expect((await replyOf(response)).error?.code).toBe('NOT_FOUND')
  })

  it('a database failure is mapped: 54000 is 429, anything else a detail-free 500', async () => {
    scripted('checkout_cancel', dbError('54000'))
    expect((await checkoutPost(request(cancelBody()))).status).toBe(429)
    scripted('checkout_cancel', dbError('08006'))
    const failed = await checkoutPost(request(cancelBody()))
    expect(failed.status).toBe(500)
    expect(JSON.stringify(await replyOf(failed))).not.toContain('detail that must never leave')
  })

  it('a pending invoice the provider cancels: the attempt is closed cancelled, then the order is cancelled', async () => {
    scripted('checkout_cancel', active('pending'), cancelled)
    client.cancelInvoice.mockResolvedValue(good(invoiceOf({ status: 'canceled' })))
    const response = await checkoutPost(request(cancelBody()))
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: { status: 'cancelled' } })
    expect(names()).toEqual(['checkout_cancel', 'payment_attempt_close', 'checkout_cancel'])
    expect(client.cancelInvoice).toHaveBeenCalledWith(INVOICE_ID)
    expect(calls('payment_attempt_close')[0]).toEqual({ p_attempt: ATTEMPT, p_status: 'cancelled', p_error: 'BUYER_CANCELLED' })
    expect(client.fetchInvoice).not.toHaveBeenCalled()
    for (const second of calls('checkout_cancel')) expect(second).toEqual({ p_order_number: NUMBER, p_access_token_hash: hashOf(TOKEN) })
  })

  it.each([
    ['canceled', 'cancelled', 'BUYER_CANCELLED'],
    ['expired', 'expired', null],
  ])('a cancel the provider cannot do, for an invoice it reports %s: the attempt is closed %s, then the order is cancelled', async (invoiceStatus, closeAs, error) => {
    scripted('checkout_cancel', active('pending'), cancelled)
    client.cancelInvoice.mockResolvedValue({ ok: false, kind: 'refused', status: 400 })
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: invoiceStatus })))
    const response = await checkoutPost(request(cancelBody()))
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: { status: 'cancelled' } })
    expect(names()).toEqual(['checkout_cancel', 'payment_attempt_close', 'checkout_cancel'])
    expect(calls('payment_attempt_close')[0]).toEqual({ p_attempt: ATTEMPT, p_status: closeAs, p_error: error })
    expect(client.fetchInvoice).toHaveBeenCalledWith(INVOICE_ID)
  })

  it('a cancel that answers 200 with another status than canceled is not trusted: the invoice is fetched', async () => {
    scripted('checkout_cancel', active('pending'), cancelled)
    client.cancelInvoice.mockResolvedValue(good(invoiceOf({ status: 'initiated' })))
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'canceled' })))
    expect((await checkoutPost(request(cancelBody()))).status).toBe(200)
    expect(client.fetchInvoice).toHaveBeenCalledTimes(1)
  })

  // A 3-D Secure payment that completed around the cancel: the invoice is canceled and still lists the charge. Closing the
  // attempt would tell the buyer "cancelled" and release the holds while the card was charged, so it is settled like any other.
  it.each(['paid', 'refunded', 'captured'])('a cancel that answers 200 canceled but lists a %s payment settles it: no close, the order\'s real status', async (paymentStatus) => {
    scripted('checkout_cancel', active('pending'))
    scripted('apply_verified_payment', { outcome: 'paid', orderNumber: NUMBER })
    scripted('payment_state', { state: 'paid', hasToken: true })
    const charged = invoiceOf({ status: 'canceled', payments: [{ id: PAYMENT_ID, status: paymentStatus }] })
    client.cancelInvoice.mockResolvedValue(good(charged))
    client.fetchInvoice.mockResolvedValue(good(charged))
    client.fetchPayment.mockResolvedValue(good(paymentOf({ status: paymentStatus })))
    const response = await checkoutPost(request(cancelBody()))
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: { status: 'paid' } })
    expect(names()).toEqual(['checkout_cancel', 'apply_verified_payment', 'payment_state'])
    expect(calls('payment_attempt_close')).toHaveLength(0)
  })

  it('a canceled invoice that lists a charged payment, which cannot then be read, is 409 PAYMENT_ACTIVE and nothing is cancelled', async () => {
    scripted('checkout_cancel', active('pending'))
    client.cancelInvoice.mockResolvedValue(good(invoiceOf({ status: 'canceled', payments: [{ id: PAYMENT_ID, status: 'paid' }] })))
    await busy(await checkoutPost(request(cancelBody())))
    expect(names()).toEqual(['checkout_cancel'])
  })

  it.each(['paid', 'refunded', 'captured'])('an invoice that lists a %s payment is settled, never cancelled: the order\'s real status comes back', async (paymentStatus) => {
    scripted('checkout_cancel', active('pending'))
    scripted('apply_verified_payment', { outcome: 'paid', orderNumber: NUMBER })
    scripted('payment_state', { state: 'paid', hasToken: true })
    client.cancelInvoice.mockResolvedValue({ ok: false, kind: 'refused', status: 400 })
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid', payments: [{ id: PAYMENT_ID, status: paymentStatus }] })))
    client.fetchPayment.mockResolvedValue(good(paymentOf({ status: paymentStatus })))
    const response = await checkoutPost(request(cancelBody()))
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: { status: 'paid' } })
    expect(names()).toEqual(['checkout_cancel', 'apply_verified_payment', 'payment_state'])
    expect(calls('apply_verified_payment')[0]).toMatchObject({ p_invoice_id: INVOICE_ID, p_mode: 'test', p_live: null, p_event_id: null })
    expect(calls('payment_state')[0]).toEqual({ p_order_number: NUMBER, p_access_token_hash: hashOf(TOKEN), p_mode: 'test' })
    expect(calls('payment_attempt_close')).toHaveLength(0)
  })

  // One vocabulary: the order's own status word, as checkout_cancel answers, not payment_state's.
  it.each([
    ['needs_resolution', 'paid_needs_resolution'],
    ['refunded', 'refunded'],
  ])('a paid invoice the provider answers 200 to (the cancel did nothing) is settled the same way; payment_state %s is answered as %s', async (state, status) => {
    scripted('checkout_cancel', active('pending'))
    scripted('apply_verified_payment', { outcome: 'paid' })
    scripted('payment_state', { state, hasToken: true })
    const paid = invoiceOf({ status: 'paid', payments: [{ id: PAYMENT_ID, status: 'paid' }] })
    client.cancelInvoice.mockResolvedValue(good(paid))
    client.fetchInvoice.mockResolvedValue(good(paid))
    client.fetchPayment.mockResolvedValue(good(paymentOf()))
    expect(await replyOf(await checkoutPost(request(cancelBody())))).toEqual({ ok: true, data: { status } })
  })

  it('a payment that is charged beats an expired or canceled invoice: the money is settled first', async () => {
    scripted('checkout_cancel', active('pending'))
    scripted('apply_verified_payment', { outcome: 'paid' })
    scripted('payment_state', { state: 'paid', hasToken: true })
    client.cancelInvoice.mockResolvedValue({ ok: false, kind: 'refused', status: 400 })
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'expired', payments: [{ id: PAYMENT_ID, status: 'paid' }] })))
    client.fetchPayment.mockResolvedValue(good(paymentOf()))
    expect(await replyOf(await checkoutPost(request(cancelBody())))).toEqual({ ok: true, data: { status: 'paid' } })
    expect(calls('payment_attempt_close')).toHaveLength(0)
  })

  it('a charged payment that lands in review is answered as review; the order is not cancelled', async () => {
    scripted('checkout_cancel', active('pending'))
    scripted('apply_verified_payment', { outcome: 'review', reason: 'AMOUNT_MISMATCH' })
    scripted('payment_state', { state: 'review', hasToken: true })
    client.cancelInvoice.mockResolvedValue({ ok: false, kind: 'refused', status: 400 })
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid', payments: [{ id: PAYMENT_ID, status: 'paid' }] })))
    client.fetchPayment.mockResolvedValue(good(paymentOf({ amount: TOTAL - 100 })))
    expect(await replyOf(await checkoutPost(request(cancelBody())))).toEqual({ ok: true, data: { status: 'review' } })
    expect(names()).not.toContain('payment_attempt_close')
    expect(names().filter((fn) => fn === 'checkout_cancel')).toHaveLength(1)
  })

  it('a settle that fails on the database is 409 PAYMENT_ACTIVE, and nothing is cancelled', async () => {
    scripted('checkout_cancel', active('pending'))
    scripted('apply_verified_payment', { outcome: 'rejected' })
    scripted('payment_attempt_checked', dbError('08006'))
    client.cancelInvoice.mockResolvedValue({ ok: false, kind: 'refused', status: 400 })
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid', payments: [{ id: PAYMENT_ID, status: 'paid' }] })))
    client.fetchPayment.mockResolvedValue(good(paymentOf()))
    await busy(await checkoutPost(request(cancelBody())))
    expect(names()).not.toContain('payment_state')
    expect(calls('payment_attempt_close')).toHaveLength(0)
  })

  // A settle that returns normally has not always settled; the order is then still open, and a 200 would tell a buyer
  // whose card was charged that the cancel went through.
  describe.each([
    ['the listed payment cannot be fetched', unavailable, { outcome: 'paid' }],
    ['the store refuses to apply it (rejected)', good(paymentOf()), { outcome: 'rejected' }],
    ['the store does not take it as paid (not_paid)', good(paymentOf()), { outcome: 'not_paid' }],
  ])('a charged payment is listed but %s', (_label, fetched, applied) => {
    const arrange = (state: string): void => {
      scripted('checkout_cancel', active('pending'))
      scripted('apply_verified_payment', applied)
      scripted('payment_state', { state, hasToken: true })
      client.cancelInvoice.mockResolvedValue({ ok: false, kind: 'refused', status: 400 })
      client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid', payments: [{ id: PAYMENT_ID, status: 'paid' }] })))
      client.fetchPayment.mockResolvedValue(fetched)
    }

    it('is 409 PAYMENT_ACTIVE while the order is still pending, and nothing is cancelled', async () => {
      arrange('pending')
      await busy(await checkoutPost(request(cancelBody())))
      expect(names()).toContain('payment_state')
      expect(names()).not.toContain('payment_attempt_close')
      expect(names().filter((fn) => fn === 'checkout_cancel')).toHaveLength(1)
    })

    // Not a settled word either: the answer is never a final one, whatever the order's own state says.
    it.each(['expired', 'cancelled', 'unknown'])('is 409 PAYMENT_ACTIVE for the state %s too', async (state) => {
      arrange(state)
      await busy(await checkoutPost(request(cancelBody())))
      expect(names()).not.toContain('payment_attempt_close')
    })
  })

  it.each([
    ['the provider cannot be reached at all', { ok: false, kind: 'uncertain' }, { ok: false, kind: 'unavailable' }],
    ['the cancel is refused and the invoice cannot be read', { ok: false, kind: 'refused', status: 400 }, { ok: false, kind: 'unavailable' }],
    ['the cancel fails (500) and the invoice is still payable', { ok: false, kind: 'uncertain', status: 500 }, good(invoiceOf({ status: 'initiated' }))],
    ['the invoice is on hold, or in a status nothing here decides', { ok: false, kind: 'refused', status: 400 }, good(invoiceOf({ status: 'on_hold' }))],
    ['the invoice is paid but lists no payment', { ok: false, kind: 'refused', status: 400 }, good(invoiceOf({ status: 'paid', payments: [] }))],
    ['the listed payment is not charged', { ok: false, kind: 'refused', status: 400 }, good(invoiceOf({ payments: [{ id: PAYMENT_ID, status: 'failed' }] }))],
  ])('%s: 409 PAYMENT_ACTIVE and nothing is cancelled', async (_label, cancelReply, fetchReply) => {
    scripted('checkout_cancel', active('pending'))
    client.cancelInvoice.mockResolvedValue(cancelReply)
    client.fetchInvoice.mockResolvedValue(fetchReply)
    await busy(await checkoutPost(request(cancelBody())))
    expect(names()).toEqual(['checkout_cancel'])
  })

  it.each([
    ['creating', { providerInvoiceId: null }],
    ['uncertain', { providerInvoiceId: null }],
    ['uncertain', {}],
    ['pending', { providerInvoiceId: null }],
  ])('an attempt that is %s %j is the payment job\'s: 409 PAYMENT_ACTIVE with no provider call', async (status, over) => {
    scripted('checkout_cancel', active(status, over))
    await busy(await checkoutPost(request(cancelBody())))
    expect(providerCalls()).toBe(0)
    expect(names()).toEqual(['checkout_cancel'])
  })

  it('a reply that is not the shape the SQL promises is 409 PAYMENT_ACTIVE too', async () => {
    scripted('checkout_cancel', { ok: false, code: 'PAYMENT_ACTIVE' })
    await busy(await checkoutPost(request(cancelBody())))
    expect(providerCalls()).toBe(0)
  })

  it('a new attempt that raced in while the old one was closed keeps the order: 409 PAYMENT_ACTIVE', async () => {
    scripted('checkout_cancel', active('pending'), active('creating', { attemptId: randomUUID(), providerInvoiceId: null }))
    client.cancelInvoice.mockResolvedValue(good(invoiceOf({ status: 'canceled' })))
    await busy(await checkoutPost(request(cancelBody())))
    expect(names()).toEqual(['checkout_cancel', 'payment_attempt_close', 'checkout_cancel'])
  })

  it('an attempt the job closed first (the close is a bad transition) still ends with the order cancelled', async () => {
    scripted('checkout_cancel', active('pending'), cancelled)
    scripted('payment_attempt_close', { ok: false, code: 'BAD_TRANSITION' })
    client.cancelInvoice.mockResolvedValue(good(invoiceOf({ status: 'canceled' })))
    expect(await replyOf(await checkoutPost(request(cancelBody())))).toEqual({ ok: true, data: { status: 'cancelled' } })
  })

  it('a failure closing the attempt is a detail-free 500, and the order is not cancelled', async () => {
    scripted('checkout_cancel', active('pending'))
    scripted('payment_attempt_close', dbError('08006'))
    client.cancelInvoice.mockResolvedValue(good(invoiceOf({ status: 'canceled' })))
    const response = await checkoutPost(request(cancelBody()))
    expect(response.status).toBe(500)
    expect(JSON.stringify(await replyOf(response))).not.toContain('detail that must never leave')
    expect(names().filter((fn) => fn === 'checkout_cancel')).toHaveLength(1)
  })

  it('a failure of the state read after a settle is a detail-free 500', async () => {
    scripted('checkout_cancel', active('pending'))
    scripted('apply_verified_payment', { outcome: 'paid' })
    scripted('payment_state', dbError('08006'))
    client.cancelInvoice.mockResolvedValue({ ok: false, kind: 'refused', status: 400 })
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid', payments: [{ id: PAYMENT_ID, status: 'paid' }] })))
    client.fetchPayment.mockResolvedValue(good(paymentOf()))
    expect((await checkoutPost(request(cancelBody()))).status).toBe(500)
  })

  it('never puts the provider\'s ids or the token in what it answers', async () => {
    scripted('checkout_cancel', active('pending'), cancelled)
    client.cancelInvoice.mockResolvedValue(good(invoiceOf({ status: 'canceled' })))
    const text = await (await checkoutPost(request(cancelBody()))).text()
    for (const secret of [INVOICE_ID, ATTEMPT, TOKEN, config.secretKey]) expect(text).not.toContain(secret)
  })
})
