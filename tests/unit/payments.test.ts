// P08 round 3: the payment core's Edge Function side
// (supabase/functions/_shared/payments.ts, contract section 7) with a recording
// rpc and a stub Moyasar client: no network, no database. The SQL decisions are
// proven in tests/integration/payment.test.ts, and the whole thing against the
// real functions and the emulator in tests/integration/payment-http.test.ts;
// what is proven here is every branch of the handler, the invoice step, the
// settle functions and the reconciliation job, and that no double ever receives
// a body, a secret or a token it should not (the exact rpc arguments are asserted).
import { createHash, randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import { handleJobs } from '../../supabase/functions/_shared/jobs.ts'
import {
  handlePayments,
  resolveUncertain,
  runPaymentsReconcile,
  settleInvoice,
  settlePayment,
  startPayment,
  type PaymentDeps,
} from '../../supabase/functions/_shared/payments.ts'
import type {
  MoyasarClient,
  MoyasarInvoice,
  MoyasarPayment,
  MoyasarResult,
  PaymentsConfigOk,
} from '../../supabase/functions/_shared/payments/moyasar.ts'
import { clientKeyHash } from '../../supabase/functions/_shared/rate-limit.ts'
import { orderAccessTokenHash } from '../../supabase/functions/_shared/tokens.ts'

const SITE = 'http://localhost:3000'
const PEPPER = 'unit-test-pepper'
const WEBHOOK_SECRET = 'unit-test-webhook-secret-of-at-least-32-characters'
const SECRET_KEY = 'sk_test_unit_test_key_value'
const CALLBACK_BASE = 'http://127.0.0.1:54321/functions/v1'
const ORDER_NUMBER = 'ABCD2345'
const ATTEMPT = randomUUID()
const INVOICE_ID = randomUUID()
const PAYMENT_ID = randomUUID()
const EVENT_ID = randomUUID()
const TOTAL = 12_500
const EXPIRES = '2026-10-02T12:20:00.123456+00:00'
const ZERO_HASH = '0'.repeat(64)

const config: PaymentsConfigOk = {
  ok: true,
  baseUrl: 'http://127.0.0.1:54390/v1',
  secretKey: SECRET_KEY,
  webhookSecret: WEBHOOK_SECRET,
  mode: 'test',
  callbackBase: CALLBACK_BASE,
  storageBase: 'http://127.0.0.1:54321/storage/v1',
}

// ---- the doubles --------------------------------------------------------------------------------------------

type Call = { fn: string; args: Record<string, unknown> }
const calls: Call[] = []
/** What each SQL function answers: one value (repeated), or a sequence (the last repeats). An Error is thrown, a function is called. */
const script = new Map<string, unknown[]>()
const reply = (fn: string, ...values: unknown[]): void => void script.set(fn, values)
const rpc: Rpc = async (fn, args) => {
  calls.push({ fn, args })
  const values = script.get(fn) ?? []
  const value = values.length > 1 ? values.shift() : values[0]
  if (value instanceof Error) throw value
  return typeof value === 'function' ? (value as (given: Record<string, unknown>) => unknown)(args) : (value ?? null)
}
const called = (fn: string): Call[] => calls.filter((call) => call.fn === fn)
const names = (): string[] => calls.map((call) => call.fn)
const sqlError = (code: string): Error => Object.assign(new Error('sql'), { code })

const client = {
  createInvoice: vi.fn(),
  fetchInvoice: vi.fn(),
  listInvoices: vi.fn(),
  cancelInvoice: vi.fn(),
  fetchPayment: vi.fn(),
  refundPayment: vi.fn(),
}
const providerCalls = (): number => Object.values(client).reduce((sum, fn) => sum + fn.mock.calls.length, 0)
const deps = (over: Partial<PaymentDeps> = {}): PaymentDeps => ({ rpc, client: client as unknown as MoyasarClient, config, ...over })

const good = <T>(data: T, status = 200): MoyasarResult<T> => ({ ok: true, status, data })
const bad = (kind: 'refused' | 'not_found' | 'rate_limited' | 'unavailable' | 'uncertain', status?: number): MoyasarResult<never> => ({
  ok: false,
  kind,
  ...(status === undefined ? {} : { status }),
})

const invoiceOf = (over: Partial<MoyasarInvoice> = {}): MoyasarInvoice => ({
  id: INVOICE_ID,
  status: 'initiated',
  amount: TOTAL,
  currency: 'SAR',
  url: `http://127.0.0.1:54390/invoices/${over.id ?? INVOICE_ID}`,
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
  fee: 150,
  refunded: 0,
  invoiceId: INVOICE_ID,
  createdAt: null,
  sourceType: 'creditcard',
  sourceCompany: 'mada',
  ...over,
})
/** An invoice as the provider lists it for this attempt. */
const mine = (over: Partial<MoyasarInvoice> = {}): MoyasarInvoice =>
  invoiceOf({ id: randomUUID(), metadata: { order_number: ORDER_NUMBER, attempt_id: ATTEMPT }, ...over })
const list = (invoices: MoyasarInvoice[], nextPage: number | null = null) => good({ invoices, nextPage })

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString()
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')
const order = { orderNumber: ORDER_NUMBER, total: TOTAL, status: 'pending_payment' }
const NEW = { ok: true, state: 'new', attemptId: ATTEMPT, amount: TOTAL, currency: 'SAR', expiresAt: EXPIRES, order }
const UNCERTAIN = (age: number) => ({ ok: true, state: 'uncertain', attemptId: ATTEMPT, createdAt: ago(age), amount: TOTAL, currency: 'SAR', order })
const INPUT = { orderNumber: 'abcd2345', accessTokenHash: 'a'.repeat(64), ipHash: null }

beforeEach(() => {
  calls.length = 0
  script.clear()
  for (const fn of Object.values(client)) fn.mockReset().mockResolvedValue(bad('unavailable'))
  reply('payment_event_record', { state: 'recorded' })
  reply('payment_attempt_created', { ok: true })
  reply('payment_attempt_close', { ok: true })
  reply('payment_callback_begin', {})
  vi.stubEnv('SITE_URL', SITE)
  vi.stubEnv('TOKEN_HASH_PEPPER', PEPPER)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// ---- requests -----------------------------------------------------------------------------------------------

const FUNCTION = 'http://127.0.0.1:54321/functions/v1/payments'

function webhookBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EVENT_ID,
    type: 'payment_paid',
    created_at: '2026-10-02T12:00:00Z',
    secret_token: WEBHOOK_SECRET,
    account_name: 'Anas',
    live: false,
    data: { id: PAYMENT_ID, status: 'paid' },
    ...over,
  }
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${FUNCTION}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const hook = (body: unknown = webhookBody()) => handlePayments(post('/webhook', body), deps())
const verifyPost = (body: unknown, headers: Record<string, string> = { origin: SITE }, over: Partial<PaymentDeps> = {}) =>
  handlePayments(post('', body, headers), deps(over))
const json = async (response: Response): Promise<Record<string, any>> => (await response.json()) as Record<string, any>

/** The provider holds a paid payment on the invoice, and the SQL settles it. */
function providerPaid(outcome: unknown = { outcome: 'paid', orderNumber: ORDER_NUMBER }): void {
  client.fetchPayment.mockResolvedValue(good(paymentOf()))
  client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid', payments: [{ id: PAYMENT_ID, status: 'paid' }] })))
  reply('apply_verified_payment', outcome)
}

/** The normalized objects `apply_verified_payment` must receive for `paymentOf()` on `invoiceOf()`. */
const normalizedPayment = {
  id: PAYMENT_ID,
  status: 'paid',
  amount: TOTAL,
  currency: 'SAR',
  fee: 150,
  refunded: 0,
  invoiceId: INVOICE_ID,
  sourceType: 'creditcard',
  sourceCompany: 'mada',
}

// ---- the webhook --------------------------------------------------------------------------------------------

describe('the webhook: the gates', () => {
  it('does not exist (404, nothing called) while payments are not configured', async () => {
    for (const name of ['MOYASAR_API_BASE_URL', 'MOYASAR_SECRET_KEY', 'MOYASAR_WEBHOOK_SECRET', 'PAYMENTS_MODE', 'FUNCTIONS_PUBLIC_URL']) {
      vi.stubEnv(name, '')
    }
    const response = await handlePayments(post('/webhook', webhookBody()))
    expect(response.status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('a method other than POST is 405', async () => {
    const response = await handlePayments(new Request(`${FUNCTION}/webhook`, { method: 'GET' }), deps())
    expect(response.status).toBe(405)
    expect(calls).toHaveLength(0)
  })

  it('a body over 256 KiB is 413, declared or streamed, and nothing is called', async () => {
    const streamed = await hook('x'.repeat(262_145))
    expect(streamed.status).toBe(413)
    const declared = await handlePayments(post('/webhook', '{}', { 'content-length': '300000' }), deps())
    expect(declared.status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it('a body just under the limit is read', async () => {
    const response = await hook(JSON.stringify(webhookBody({ type: 'balance_transferred', data: { pad: 'x'.repeat(200_000) } })))
    expect(response.status).toBe(200)
    expect(called('payment_event_record')).toHaveLength(1)
  })

  it('unparseable JSON is 400', async () => {
    const response = await hook('{nope')
    expect(response.status).toBe(400)
    expect((await json(response)).error.code).toBe('BAD_JSON')
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['a JSON array', []],
    ['no id', webhookBody({ id: undefined })],
    ['an empty id', webhookBody({ id: '' })],
    ['an id over 200 characters', webhookBody({ id: 'e'.repeat(201) })],
    ['a numeric id', webhookBody({ id: 5 })],
    ['no type', webhookBody({ type: undefined })],
    ['no secret_token', webhookBody({ secret_token: undefined })],
    ['a numeric secret_token', webhookBody({ secret_token: 12345 })],
    ['no live', webhookBody({ live: undefined })],
    ['a string live', webhookBody({ live: 'false' })],
  ])('refuses %s with 422 before anything is recorded', async (_label, body) => {
    const response = await hook(body)
    expect(response.status).toBe(422)
    expect(calls).toHaveLength(0)
    expect(providerCalls()).toBe(0)
  })

  it.each([
    ['a wrong secret_token', 'wrong-secret'],
    ['the secret with a character added', `${WEBHOOK_SECRET}x`],
    ['the secret truncated', WEBHOOK_SECRET.slice(0, -1)],
    ['an empty secret_token', ''],
    ['the secret key instead of the webhook secret', SECRET_KEY],
  ])('%s is 401: nothing is stored, nothing is fetched', async (_label, secret) => {
    const response = await hook(webhookBody({ secret_token: secret }))
    expect(response.status).toBe(401)
    expect(calls).toHaveLength(0)
    expect(providerCalls()).toBe(0)
  })
})

describe('the webhook: recorded before it is answered', () => {
  it('records the event with the hash of the raw body, never the body or the secret', async () => {
    const raw = JSON.stringify(webhookBody({ type: 'payment_authorized', data: { id: PAYMENT_ID.toUpperCase() } }))
    await hook(raw)
    expect(called('payment_event_record')).toEqual([
      {
        fn: 'payment_event_record',
        args: {
          p_event_id: EVENT_ID,
          p_type: 'payment_authorized',
          p_live: false,
          p_payment_id: PAYMENT_ID.toUpperCase(),
          p_payload_hash: sha256(raw),
        },
      },
    ])
    expect(JSON.stringify(calls)).not.toContain(WEBHOOK_SECRET)
  })

  it('a failing record is 500 and nothing else is called, so the provider sends it again', async () => {
    reply('payment_event_record', sqlError('08006'))
    const response = await hook()
    expect(response.status).toBe(500)
    expect(names()).toEqual(['payment_event_record'])
    expect(providerCalls()).toBe(0)
    expect(JSON.stringify(await json(response))).not.toContain('sql')
  })

  it('an unreadable record reply is 500 too', async () => {
    reply('payment_event_record', null)
    expect((await hook()).status).toBe(500)
    expect(names()).toEqual(['payment_event_record'])
  })

  it('a duplicate is 200 and nothing more happens: the job owns an unprocessed event', async () => {
    for (const processed of [true, false]) {
      calls.length = 0
      reply('payment_event_record', { state: 'duplicate', processed })
      const response = await hook()
      expect(response.status).toBe(200)
      expect(await json(response)).toEqual({ ok: true })
      expect(names()).toEqual(['payment_event_record'])
      expect(providerCalls()).toBe(0)
    }
  })
})

describe('the webhook: closed without the provider', () => {
  it('a type that does not start with payment_ is closed ignored', async () => {
    for (const type of ['balance_transferred', 'Payment_paid', 'refund_paid', '']) {
      calls.length = 0
      const response = await hook(webhookBody({ type }))
      expect(response.status).toBe(200)
      expect(called('payment_event_result')).toEqual([
        { fn: 'payment_event_result', args: { p_event_id: EVENT_ID, p_outcome: 'ignored', p_error: null } },
      ])
    }
    expect(providerCalls()).toBe(0)
  })

  it.each([
    ['no data', webhookBody({ data: undefined }), null],
    ['a null data', webhookBody({ data: null }), null],
    ['a data with no id', webhookBody({ data: { status: 'paid' } }), null],
    ['a numeric data id', webhookBody({ data: { id: 5 } }), null],
    ['a data id that is not a uuid', webhookBody({ data: { id: 'not-a-uuid' } }), 'not-a-uuid'],
    ['a data id with a path in it', webhookBody({ data: { id: `${PAYMENT_ID}/../x` } }), `${PAYMENT_ID}/../x`],
  ])('%s is closed no_payment_id', async (_label, body, recordedId) => {
    const response = await hook(body)
    expect(response.status).toBe(200)
    expect(called('payment_event_record')[0]!.args.p_payment_id).toBe(recordedId)
    expect(called('payment_event_result')).toEqual([
      { fn: 'payment_event_result', args: { p_event_id: EVENT_ID, p_outcome: 'no_payment_id', p_error: null } },
    ])
    expect(providerCalls()).toBe(0)
  })

  it('a live flag that is not the configured mode is closed mode_mismatch, in both directions', async () => {
    let response = await hook(webhookBody({ live: true }))
    expect(response.status).toBe(200)
    expect(called('payment_event_result')[0]!.args).toEqual({ p_event_id: EVENT_ID, p_outcome: 'mode_mismatch', p_error: null })
    calls.length = 0
    response = await handlePayments(post('/webhook', webhookBody({ live: false })), deps({ config: { ...config, mode: 'live' } }))
    expect(response.status).toBe(200)
    expect(called('payment_event_result')[0]!.args.p_outcome).toBe('mode_mismatch')
    expect(providerCalls()).toBe(0)
    expect(called('apply_verified_payment')).toHaveLength(0)
  })
})

describe('the webhook: settled inline from what the provider holds', () => {
  it('fetches the payment and its invoice, applies them, and closes the event with the outcome', async () => {
    providerPaid()
    const response = await hook()
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({ ok: true })
    expect(names()).toEqual(['payment_event_record', 'apply_verified_payment', 'payment_event_result'])
    expect(client.fetchPayment).toHaveBeenCalledWith(PAYMENT_ID)
    expect(client.fetchInvoice).toHaveBeenCalledWith(INVOICE_ID)
    expect(called('apply_verified_payment')[0]!.args).toEqual({
      p_invoice_id: INVOICE_ID,
      p_payment: normalizedPayment,
      p_invoice: { id: INVOICE_ID, status: 'paid', amount: TOTAL, currency: 'SAR' },
      p_mode: 'test',
      p_live: false,
      p_event_id: EVENT_ID,
    })
    expect(called('payment_event_result')[0]!.args).toEqual({ p_event_id: EVENT_ID, p_outcome: 'paid', p_error: null })
  })

  it('asks the provider for the lower-case id', async () => {
    providerPaid()
    await hook(webhookBody({ data: { id: PAYMENT_ID.toUpperCase() } }))
    expect(client.fetchPayment).toHaveBeenCalledWith(PAYMENT_ID)
  })

  it('the amounts it hands the SQL are the fetched integers, never the webhook body', async () => {
    providerPaid({ outcome: 'review', reason: 'AMOUNT_MISMATCH' })
    client.fetchPayment.mockResolvedValue(good(paymentOf({ amount: 99, fee: 3, refunded: 10 })))
    await hook(webhookBody({ data: { id: PAYMENT_ID, status: 'paid', amount: TOTAL, currency: 'SAR' } }))
    const sent = called('apply_verified_payment')[0]!.args
    expect(sent.p_payment).toEqual({ ...normalizedPayment, amount: 99, fee: 3, refunded: 10 })
    expect(Number.isInteger((sent.p_payment as { amount: number }).amount)).toBe(true)
    expect(called('payment_event_result')[0]!.args.p_outcome).toBe('review')
  })

  it.each(['already_paid', 'not_paid', 'review', 'rejected', 'unknown_invoice', 'paid_needs_resolution'])(
    'closes the event with the SQL outcome %s',
    async (outcome) => {
      providerPaid({ outcome })
      expect((await hook()).status).toBe(200)
      expect(called('payment_event_result')[0]!.args).toEqual({ p_event_id: EVENT_ID, p_outcome: outcome, p_error: null })
    },
  )

  it('a payment our key cannot see (404) is closed unknown_payment, and nothing is applied', async () => {
    client.fetchPayment.mockResolvedValue(bad('not_found', 404))
    expect((await hook()).status).toBe(200)
    expect(called('payment_event_result')[0]!.args).toEqual({ p_event_id: EVENT_ID, p_outcome: 'unknown_payment', p_error: null })
    expect(client.fetchInvoice).not.toHaveBeenCalled()
    expect(called('apply_verified_payment')).toHaveLength(0)
  })

  it.each([
    ['rate_limited', bad('rate_limited', 429), 'PAYMENT_FETCH_RATE_LIMITED'],
    ['unavailable', bad('unavailable'), 'PAYMENT_FETCH_UNAVAILABLE'],
    ['refused', bad('refused', 401), 'PAYMENT_FETCH_REFUSED'],
  ])('any other failure to fetch the payment (%s) is retry, never "not paid"', async (_label, result, error) => {
    client.fetchPayment.mockResolvedValue(result)
    expect((await hook()).status).toBe(200)
    expect(called('payment_event_result')[0]!.args).toEqual({ p_event_id: EVENT_ID, p_outcome: 'retry', p_error: error })
    expect(called('apply_verified_payment')).toHaveLength(0)
  })

  it('a payment with no invoice is closed no_invoice, and its invoice is never fetched', async () => {
    client.fetchPayment.mockResolvedValue(good(paymentOf({ invoiceId: null })))
    expect((await hook()).status).toBe(200)
    expect(called('payment_event_result')[0]!.args).toEqual({ p_event_id: EVENT_ID, p_outcome: 'no_invoice', p_error: null })
    expect(client.fetchInvoice).not.toHaveBeenCalled()
  })

  it.each([
    ['not_found', bad('not_found', 404)],
    ['unavailable', bad('unavailable')],
  ])('an invoice that cannot be fetched (%s) is retry: money may be involved, so it is retried and alerted, never closed', async (_label, result) => {
    client.fetchPayment.mockResolvedValue(good(paymentOf()))
    client.fetchInvoice.mockResolvedValue(result)
    expect((await hook()).status).toBe(200)
    expect(called('payment_event_result')[0]!.args.p_outcome).toBe('retry')
    expect(called('apply_verified_payment')).toHaveLength(0)
  })

  it('an apply that raises, or answers nothing readable, is retry APPLY_FAILED and still 200', async () => {
    for (const answer of [sqlError('22023'), null, { reason: 'X' }]) {
      calls.length = 0
      providerPaid(answer)
      expect((await hook()).status).toBe(200)
      expect(called('payment_event_result')[0]!.args).toEqual({ p_event_id: EVENT_ID, p_outcome: 'retry', p_error: 'APPLY_FAILED' })
    }
  })

  it('a settle that throws after the record leaves the event for the job and still answers 200', async () => {
    client.fetchPayment.mockRejectedValue(new Error('connection reset'))
    const response = await hook()
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({ ok: true })
    expect(names()).toEqual(['payment_event_record'])
  })

  it('so does a result that cannot be written', async () => {
    providerPaid()
    reply('payment_event_result', sqlError('08006'))
    expect((await hook()).status).toBe(200)
    expect(names()).toEqual(['payment_event_record', 'apply_verified_payment', 'payment_event_result'])
  })
})

// ---- the invoice callback -----------------------------------------------------------------------------------

describe('the invoice callback', () => {
  const callbackAs = (body: unknown, headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.9' }) =>
    post('/callback', body, headers)

  it('does not exist (404) while payments are not configured, and a method other than POST is 405', async () => {
    for (const name of ['MOYASAR_API_BASE_URL', 'MOYASAR_SECRET_KEY', 'MOYASAR_WEBHOOK_SECRET', 'PAYMENTS_MODE', 'FUNCTIONS_PUBLIC_URL']) {
      vi.stubEnv(name, '')
    }
    expect((await handlePayments(callbackAs({ id: INVOICE_ID }))).status).toBe(404)
    vi.unstubAllEnvs()
    expect((await handlePayments(new Request(`${FUNCTION}/callback`, { method: 'GET' }), deps())).status).toBe(405)
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['not JSON', '{nope'],
    ['an empty body', ''],
    ['an object with no id', { status: 'paid' }],
    ['a numeric id', { id: 5 }],
    ['an id that is not a uuid', { id: 'not-a-uuid' }],
    ['an id with a path in it', { id: `${INVOICE_ID}/cancel` }],
    ['null', 'null'],
    ['an array', '[]'],
    ['an oversized body', 'x'.repeat(70_000)],
  ])('%s: nothing happens, and the answer is 200 {ok:true}', async (_label, body) => {
    const response = await handlePayments(callbackAs(body), deps())
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({ ok: true })
    expect(calls).toHaveLength(0)
    expect(providerCalls()).toBe(0)
  })

  it('a uuid id asks payment_callback_begin with the peppered IP hash and the mode, and nothing else without a check', async () => {
    // The id goes to the ledger as the provider wrote it, upper case included.
    const request = callbackAs({ id: INVOICE_ID.toUpperCase(), status: 'paid' })
    const response = await handlePayments(request, deps())
    expect(response.status).toBe(200)
    expect(calls).toEqual([
      {
        fn: 'payment_callback_begin',
        args: { p_invoice_id: INVOICE_ID.toUpperCase(), p_ip_hash: await clientKeyHash(request, PEPPER), p_mode: 'test' },
      },
    ])
    expect(providerCalls()).toBe(0)
  })

  it('a check settles the attempt as a prompt from what the provider holds, never from the body', async () => {
    reply('payment_callback_begin', { check: { attemptId: ATTEMPT, providerInvoiceId: INVOICE_ID } })
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'initiated' })))
    // The body claims it is paid, for any amount.
    const response = await handlePayments(callbackAs({ id: INVOICE_ID, status: 'paid', amount: 1, payments: [{ id: PAYMENT_ID, status: 'paid' }] }), deps())
    expect(response.status).toBe(200)
    expect(client.fetchInvoice).toHaveBeenCalledWith(INVOICE_ID)
    expect(client.fetchPayment).not.toHaveBeenCalled()
    expect(called('apply_verified_payment')).toHaveLength(0)
    expect(called('payment_attempt_checked')).toEqual([
      {
        fn: 'payment_attempt_checked',
        args: { p_attempt: ATTEMPT, p_source: 'prompt', p_ok: true, p_provider_status: 'initiated', p_error: null },
      },
    ])
  })

  it('answers 200 even when the database or the provider fails', async () => {
    reply('payment_callback_begin', sqlError('08006'))
    expect((await handlePayments(callbackAs({ id: INVOICE_ID }), deps())).status).toBe(200)
    reply('payment_callback_begin', { check: { attemptId: ATTEMPT, providerInvoiceId: INVOICE_ID } })
    client.fetchInvoice.mockRejectedValue(new Error('reset'))
    const response = await handlePayments(callbackAs({ id: INVOICE_ID }), deps())
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({ ok: true })
  })

  it('without the pepper it cannot hash the caller, so nothing happens', async () => {
    vi.stubEnv('TOKEN_HASH_PEPPER', '')
    const response = await handlePayments(callbackAs({ id: INVOICE_ID }), deps())
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(0)
  })
})

// ---- the return page's verify -------------------------------------------------------------------------------

describe('verify', () => {
  const TOKEN = 'V'.repeat(43)
  const body = (over: Record<string, unknown> = {}) => ({ action: 'verify', orderNumber: ORDER_NUMBER, ...over })

  it('answers the CORS preflight for the site origin, even while payments are not configured', async () => {
    const response = await handlePayments(new Request(FUNCTION, { method: 'OPTIONS', headers: { origin: SITE } }))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(SITE)
  })

  it('refuses a method other than POST with 405', async () => {
    expect((await handlePayments(new Request(FUNCTION, { method: 'GET' }), deps())).status).toBe(405)
  })

  it('refuses a foreign origin, and no origin, with 403 before anything is called', async () => {
    expect((await verifyPost(body(), { origin: 'https://evil.test' })).status).toBe(403)
    expect((await verifyPost(body(), {})).status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('answers 503 UNAVAILABLE without the pepper, without SITE_URL, and while payments are not configured', async () => {
    vi.stubEnv('TOKEN_HASH_PEPPER', '')
    expect((await verifyPost(body())).status).toBe(503)
    vi.stubEnv('TOKEN_HASH_PEPPER', PEPPER)
    vi.stubEnv('SITE_URL', '')
    expect((await verifyPost(body(), { origin: SITE })).status).toBe(503)
    vi.stubEnv('SITE_URL', SITE)
    for (const name of ['MOYASAR_API_BASE_URL', 'MOYASAR_SECRET_KEY', 'MOYASAR_WEBHOOK_SECRET', 'PAYMENTS_MODE', 'FUNCTIONS_PUBLIC_URL']) {
      vi.stubEnv(name, '')
    }
    const response = await handlePayments(post('', body(), { origin: SITE }))
    expect(response.status).toBe(503)
    expect((await json(response)).error.code).toBe('UNAVAILABLE')
    expect(calls).toHaveLength(0)
  })

  it('refuses a non-JSON content type (415), bad JSON (400) and an oversized body (413)', async () => {
    expect((await handlePayments(post('', 'x', { origin: SITE, 'content-type': 'text/plain' }), deps())).status).toBe(415)
    expect((await verifyPost('{nope')).status).toBe(400)
    expect((await verifyPost(body({ padding: 'x'.repeat(70_000) }))).status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['an unknown action', body({ action: 'cancel' })],
    ['no action', { orderNumber: ORDER_NUMBER }],
    ['a bad order number', body({ orderNumber: 'ABCD01' })],
    ['a bad access token', body({ accessToken: 'short' })],
    ['an unknown field', body({ website: 'x' })],
  ])('refuses %s with 422 INVALID', async (_label, payload) => {
    const response = await verifyPost(payload)
    expect(response.status).toBe(422)
    expect((await json(response)).error.code).toBe('INVALID')
    expect(calls).toHaveLength(0)
  })

  it('with no token it sends 64 zeros, and answers the state alone: no invoice URL, hasToken false', async () => {
    reply('payment_check_begin', { state: 'pending', hasToken: false })
    const request = post('', body({ orderNumber: ' abcd2345 ' }), { origin: SITE, 'cf-connecting-ip': '203.0.113.9' })
    const response = await handlePayments(request, deps())
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(await json(response)).toEqual({ ok: true, data: { state: 'pending', hasToken: false, testMode: true } })
    expect(calls).toEqual([
      {
        fn: 'payment_check_begin',
        args: { p_order_number: ORDER_NUMBER, p_access_token_hash: ZERO_HASH, p_ip_hash: await clientKeyHash(request, PEPPER), p_mode: 'test' },
      },
    ])
    expect(providerCalls()).toBe(0)
  })

  it('a token is sent only as the hash tokens.ts makes, never in clear', async () => {
    reply('payment_check_begin', { state: 'pending', hasToken: true, invoiceUrl: 'http://127.0.0.1:54390/invoices/x' })
    const response = await verifyPost(body({ accessToken: TOKEN }))
    expect(await json(response)).toEqual({
      ok: true,
      data: { state: 'pending', hasToken: true, invoiceUrl: 'http://127.0.0.1:54390/invoices/x', testMode: true },
    })
    expect(called('payment_check_begin')[0]!.args.p_access_token_hash).toBe(await orderAccessTokenHash(PEPPER, TOKEN))
    expect(JSON.stringify(calls)).not.toContain(TOKEN)
  })

  it('only state, hasToken, invoiceUrl and testMode leave: the check and any other field stay inside', async () => {
    reply('payment_check_begin', { state: 'unknown', hasToken: false, orderId: randomUUID(), secret: 'x', check: undefined })
    expect((await json(await verifyPost(body()))).data).toEqual({ state: 'unknown', hasToken: false, testMode: true })
  })

  it('a check settles the attempt as a prompt, then the state is read again and that is the answer', async () => {
    reply('payment_check_begin', {
      state: 'pending',
      hasToken: true,
      invoiceUrl: 'http://127.0.0.1:54390/invoices/x',
      check: { attemptId: ATTEMPT, providerInvoiceId: INVOICE_ID },
    })
    reply('payment_state', { state: 'paid', hasToken: true })
    providerPaid()
    const response = await verifyPost(body({ accessToken: TOKEN }))
    expect(await json(response)).toEqual({ ok: true, data: { state: 'paid', hasToken: true, testMode: true } })
    expect(names()).toEqual(['payment_check_begin', 'apply_verified_payment', 'payment_state'])
    expect(called('apply_verified_payment')[0]!.args).toMatchObject({ p_invoice_id: INVOICE_ID, p_live: null, p_event_id: null, p_mode: 'test' })
    const hash = await orderAccessTokenHash(PEPPER, TOKEN)
    expect(called('payment_state')[0]!.args).toEqual({ p_order_number: ORDER_NUMBER, p_access_token_hash: hash, p_mode: 'test' })
  })

  it('a settle that throws still answers the state the database holds', async () => {
    reply('payment_check_begin', { state: 'pending', hasToken: false, check: { attemptId: ATTEMPT, providerInvoiceId: INVOICE_ID } })
    reply('payment_state', { state: 'pending', hasToken: false })
    client.fetchInvoice.mockRejectedValue(new Error('reset'))
    const response = await verifyPost(body())
    expect(response.status).toBe(200)
    expect((await json(response)).data.state).toBe('pending')
  })

  it('testMode is false in live mode', async () => {
    reply('payment_check_begin', { state: 'paid', hasToken: false })
    const response = await verifyPost(body(), { origin: SITE }, { config: { ...config, mode: 'live' } })
    expect((await json(response)).data.testMode).toBe(false)
    expect(called('payment_check_begin')[0]!.args.p_mode).toBe('live')
  })

  it('a throttle (SQLSTATE 54000) is 429 RATE_LIMITED, and any other database failure a detail-free 500', async () => {
    reply('payment_check_begin', sqlError('54000'))
    const throttled = await verifyPost(body())
    expect(throttled.status).toBe(429)
    expect((await json(throttled)).error.code).toBe('RATE_LIMITED')
    expect(throttled.headers.get('access-control-allow-origin')).toBe(SITE)
    reply('payment_check_begin', sqlError('08006'))
    const broken = await verifyPost(body())
    expect(broken.status).toBe(500)
    expect((await json(broken)).error.code).toBe('FAILED')
  })
})

// ---- the invoice step ---------------------------------------------------------------------------------------

describe('startPayment: the begin step', () => {
  it('sends the order number upper-cased, the token hash, the configured mode and the IP hash', async () => {
    reply('payment_attempt_begin', { ok: false, code: 'NOT_FOUND' })
    expect(await startPayment(deps(), { ...INPUT, ipHash: 'b'.repeat(64) })).toEqual({ kind: 'not_found' })
    expect(calls).toEqual([
      {
        fn: 'payment_attempt_begin',
        args: { p_order_number: ORDER_NUMBER, p_access_token_hash: INPUT.accessTokenHash, p_mode: 'test', p_ip_hash: 'b'.repeat(64) },
      },
    ])
  })

  it('a SQL throttle is rate_limited; any other database failure is thrown for the caller to map', async () => {
    reply('payment_attempt_begin', sqlError('54000'))
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'rate_limited' })
    reply('payment_attempt_begin', sqlError('08006'))
    await expect(startPayment(deps(), INPUT)).rejects.toMatchObject({ code: '08006' })
  })

  it('without SITE_URL it throws before it touches the database', async () => {
    vi.stubEnv('SITE_URL', '')
    await expect(startPayment(deps(), INPUT)).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it.each([
    [{ ok: false, code: 'HOLD_EXPIRED', order }, { state: 'closed', code: 'HOLD_EXPIRED' }],
    [{ ok: false, code: 'ORDER_NOT_PAYABLE', status: 'paid', reason: 'NOT_PENDING', order }, { state: 'closed', code: 'ORDER_NOT_PAYABLE', status: 'paid' }],
    [{ ok: false, code: 'ORDER_NOT_PAYABLE', status: 'pending_payment', reason: 'UNDER_REVIEW', order }, { state: 'closed', code: 'ORDER_NOT_PAYABLE', status: 'pending_payment' }],
    [{ ok: false, code: 'TOO_MANY_ATTEMPTS', order }, { state: 'closed', code: 'TOO_MANY_ATTEMPTS' }],
    [{ ok: false, code: 'TOTAL_BELOW_MINIMUM', order }, { state: 'closed', code: 'TOTAL_BELOW_MINIMUM' }],
  ])('a refusal of the begin is a closed payment with the order, and the provider is never called', async (refusal, payment) => {
    reply('payment_attempt_begin', refusal)
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment })
    expect(providerCalls()).toBe(0)
  })

  it('a pending attempt returns its stored URL and creates nothing', async () => {
    reply('payment_attempt_begin', { ok: true, state: 'pending', attemptId: ATTEMPT, invoiceUrl: 'http://127.0.0.1:54390/invoices/p', order })
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'ready', url: 'http://127.0.0.1:54390/invoices/p' } })
    expect(providerCalls()).toBe(0)
  })

  it('a creating attempt is preparing: another request is making the invoice', async () => {
    reply('payment_attempt_begin', { ok: true, state: 'creating', attemptId: ATTEMPT, order })
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'preparing' } })
    expect(providerCalls()).toBe(0)
  })
})

describe('startPayment: a new attempt', () => {
  const created = (over: Partial<MoyasarInvoice> = {}) => good(invoiceOf({ metadata: { order_number: ORDER_NUMBER, attempt_id: ATTEMPT }, ...over }), 201)

  it('creates the invoice with exactly the documented fields, nothing about the buyer, then maps it and returns its URL', async () => {
    reply('payment_attempt_begin', NEW)
    client.createInvoice.mockResolvedValue(created())
    const result = await startPayment(deps(), INPUT)
    expect(result).toEqual({ kind: 'ok', order, payment: { state: 'ready', url: `http://127.0.0.1:54390/invoices/${INVOICE_ID}` } })
    expect(client.createInvoice).toHaveBeenCalledTimes(1)
    expect(client.createInvoice).toHaveBeenCalledWith({
      amount: TOTAL,
      currency: 'SAR',
      description: `طلب ${ORDER_NUMBER}`,
      callback_url: `${CALLBACK_BASE}/payments/callback`,
      success_url: `${SITE}/checkout/return?order=${ORDER_NUMBER}`,
      back_url: `${SITE}/checkout/return?order=${ORDER_NUMBER}`,
      expired_at: '2026-10-02T12:20:00.123Z',
      metadata: { order_number: ORDER_NUMBER, attempt_id: ATTEMPT },
    })
    expect(called('payment_attempt_created')).toEqual([
      {
        fn: 'payment_attempt_created',
        args: {
          p_attempt: ATTEMPT,
          p_invoice_id: INVOICE_ID,
          p_invoice_url: `http://127.0.0.1:54390/invoices/${INVOICE_ID}`,
          p_expires_at: '2026-10-02T12:20:00.000Z',
        },
      },
    ])
    expect(names()).toEqual(['payment_attempt_begin', 'payment_attempt_created'])
  })

  it('the provider expiry goes to the ledger only when it parses as a date', async () => {
    reply('payment_attempt_begin', NEW)
    for (const expiredAt of [null, 'not a date', '']) {
      calls.length = 0
      client.createInvoice.mockResolvedValue(created({ expiredAt }))
      await startPayment(deps(), INPUT)
      expect(called('payment_attempt_created')[0]!.args.p_expires_at).toBeNull()
    }
    calls.length = 0
    client.createInvoice.mockResolvedValue(created({ expiredAt: '2026-10-02T15:20:00+03:00' }))
    await startPayment(deps(), INPUT)
    expect(called('payment_attempt_created')[0]!.args.p_expires_at).toBe('2026-10-02T12:20:00.000Z')
  })

  it.each(['ATTEMPT_CLOSED', 'INVOICE_CONFLICT', 'NOT_FOUND'])(
    'a late 201 the ledger refuses (%s) is cancelled at the provider and never returned: preparing',
    async (code) => {
      reply('payment_attempt_begin', NEW)
      reply('payment_attempt_created', { ok: false, code })
      client.createInvoice.mockResolvedValue(created())
      client.cancelInvoice.mockResolvedValue(good(invoiceOf({ status: 'canceled' })))
      const result = await startPayment(deps(), INPUT)
      expect(result).toEqual({ kind: 'ok', order, payment: { state: 'preparing' } })
      expect(JSON.stringify(result)).not.toContain('/invoices/')
      expect(client.cancelInvoice).toHaveBeenCalledWith(INVOICE_ID)
    },
  )

  it('a cancel that fails changes nothing: still preparing', async () => {
    reply('payment_attempt_begin', NEW)
    reply('payment_attempt_created', { ok: false, code: 'ATTEMPT_CLOSED' })
    client.createInvoice.mockResolvedValue(created())
    for (const failure of [bad('rate_limited', 429), bad('refused', 400)]) {
      client.cancelInvoice.mockResolvedValue(failure)
      expect((await startPayment(deps(), INPUT)).kind).toBe('ok')
    }
    client.cancelInvoice.mockRejectedValue(new Error('reset'))
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'preparing' } })
  })

  it.each([
    ['a 4xx', bad('refused', 400), 'CREATE_REFUSED'],
    ['a 404', bad('not_found', 404), 'CREATE_REFUSED'],
    ['a 429', bad('rate_limited', 429), 'CREATE_RATE_LIMITED'],
  ])('%s closes the attempt failed and answers unavailable', async (_label, result, error) => {
    reply('payment_attempt_begin', NEW)
    client.createInvoice.mockResolvedValue(result)
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'unavailable' } })
    expect(called('payment_attempt_close')).toEqual([
      { fn: 'payment_attempt_close', args: { p_attempt: ATTEMPT, p_status: 'failed', p_error: error } },
    ])
    expect(called('payment_attempt_created')).toHaveLength(0)
  })

  it.each([
    ['a timeout or a network error', bad('uncertain')],
    ['a 5xx', bad('uncertain', 503)],
    ['an unreadable 2xx', bad('uncertain', 201)],
    ['a stub that says unavailable', bad('unavailable')],
  ])('%s closes the attempt uncertain and answers preparing: the call may have landed, so it is never repeated', async (_label, result) => {
    reply('payment_attempt_begin', NEW)
    client.createInvoice.mockResolvedValue(result)
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'preparing' } })
    expect(called('payment_attempt_close')).toEqual([
      { fn: 'payment_attempt_close', args: { p_attempt: ATTEMPT, p_status: 'uncertain', p_error: 'CREATE_UNCERTAIN' } },
    ])
    expect(client.createInvoice).toHaveBeenCalledTimes(1)
    expect(client.listInvoices).not.toHaveBeenCalled()
  })

  it('a database failure while mapping the invoice is thrown: the attempt stays creating and the job resolves it', async () => {
    reply('payment_attempt_begin', NEW)
    reply('payment_attempt_created', sqlError('08006'))
    client.createInvoice.mockResolvedValue(created())
    await expect(startPayment(deps(), INPUT)).rejects.toMatchObject({ code: '08006' })
    expect(client.cancelInvoice).not.toHaveBeenCalled()
  })
})

describe('startPayment: an uncertain attempt', () => {
  it('adopts the one invoice that is this attempt\'s and returns its URL; it creates nothing', async () => {
    const match = mine()
    reply('payment_attempt_begin', UNCERTAIN(5_000))
    client.listInvoices.mockResolvedValue(list([match]))
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'ready', url: match.url } })
    expect(client.listInvoices).toHaveBeenCalledWith({ metadata: { attempt_id: ATTEMPT }, page: 1 })
    expect(client.createInvoice).not.toHaveBeenCalled()
    expect(called('payment_attempt_created')[0]!.args).toMatchObject({ p_attempt: ATTEMPT, p_invoice_id: match.id, p_invoice_url: match.url })
  })

  it('a young attempt with no match is preparing: the first call may still land, so nothing is abandoned', async () => {
    reply('payment_attempt_begin', UNCERTAIN(5_000))
    client.listInvoices.mockResolvedValue(list([]))
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'preparing' } })
    expect(called('payment_attempt_close')).toHaveLength(0)
    expect(called('payment_attempt_begin')).toHaveLength(1)
    expect(client.createInvoice).not.toHaveBeenCalled()
  })

  it('a list that failed is preparing, whatever the age: absence is not proven', async () => {
    reply('payment_attempt_begin', UNCERTAIN(300_000))
    for (const failure of [bad('unavailable'), bad('rate_limited', 429), bad('refused', 400)]) {
      calls.length = 0
      client.listInvoices.mockResolvedValue(failure)
      expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'preparing' } })
      expect(names()).toEqual(['payment_attempt_begin'])
    }
  })

  it('more than one matching invoice alerts the owners once, adopts none and is preparing', async () => {
    reply('payment_attempt_begin', UNCERTAIN(5_000))
    client.listInvoices.mockResolvedValue(list([mine(), mine()]))
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'preparing' } })
    expect(called('payment_attempt_duplicates')).toEqual([{ fn: 'payment_attempt_duplicates', args: { p_attempt: ATTEMPT } }])
    expect(called('payment_attempt_created')).toHaveLength(0)
    expect(called('payment_attempt_close')).toHaveLength(0)
  })

  it('an old attempt proven absent is abandoned, then a new one is begun, once, and its invoice is created', async () => {
    reply('payment_attempt_begin', UNCERTAIN(300_000), NEW)
    client.listInvoices.mockResolvedValue(list([]))
    client.createInvoice.mockResolvedValue(good(invoiceOf(), 201))
    const result = await startPayment(deps(), INPUT)
    expect(result).toEqual({ kind: 'ok', order, payment: { state: 'ready', url: `http://127.0.0.1:54390/invoices/${INVOICE_ID}` } })
    expect(names()).toEqual(['payment_attempt_begin', 'payment_attempt_close', 'payment_attempt_begin', 'payment_attempt_created'])
    expect(called('payment_attempt_close')[0]!.args).toEqual({ p_attempt: ATTEMPT, p_status: 'abandoned', p_error: 'CREATE_ABSENT' })
    expect(called('payment_attempt_begin')[1]!.args).toEqual(called('payment_attempt_begin')[0]!.args)
    expect(client.createInvoice).toHaveBeenCalledTimes(1)
  })

  it('it begins again only once: an uncertain attempt again, or a creating one, is preparing', async () => {
    client.listInvoices.mockResolvedValue(list([]))
    reply('payment_attempt_begin', UNCERTAIN(300_000), UNCERTAIN(300_000))
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'preparing' } })
    expect(called('payment_attempt_begin')).toHaveLength(2)
    expect(client.listInvoices).toHaveBeenCalledTimes(1)
    calls.length = 0
    reply('payment_attempt_begin', UNCERTAIN(300_000), { ok: true, state: 'creating', attemptId: randomUUID(), order })
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'preparing' } })
  })

  it('what the second begin finds is the answer: a refusal, a throttle, a pending attempt', async () => {
    client.listInvoices.mockResolvedValue(list([]))
    reply('payment_attempt_begin', UNCERTAIN(300_000), { ok: false, code: 'HOLD_EXPIRED', order })
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'closed', code: 'HOLD_EXPIRED' } })
    reply('payment_attempt_begin', UNCERTAIN(300_000), sqlError('54000'))
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'rate_limited' })
    reply('payment_attempt_begin', UNCERTAIN(300_000), { ok: true, state: 'pending', attemptId: randomUUID(), invoiceUrl: 'http://127.0.0.1:54390/invoices/q', order })
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'ready', url: 'http://127.0.0.1:54390/invoices/q' } })
  })

  it('an invoice the ledger refuses to map is cancelled and not returned', async () => {
    reply('payment_attempt_begin', UNCERTAIN(5_000))
    reply('payment_attempt_created', { ok: false, code: 'INVOICE_CONFLICT' })
    const match = mine()
    client.listInvoices.mockResolvedValue(list([match]))
    client.cancelInvoice.mockResolvedValue(good(invoiceOf({ status: 'canceled' })))
    expect(await startPayment(deps(), INPUT)).toEqual({ kind: 'ok', order, payment: { state: 'preparing' } })
    expect(client.cancelInvoice).toHaveBeenCalledWith(match.id)
  })

  it('never begins a second payable invoice while it is unproven: no create, whatever the list says', async () => {
    reply('payment_attempt_begin', UNCERTAIN(5_000))
    for (const listed of [list([]), list([mine(), mine()]), bad('unavailable')]) {
      client.listInvoices.mockResolvedValue(listed)
      await startPayment(deps(), INPUT)
    }
    expect(client.createInvoice).not.toHaveBeenCalled()
  })
})

describe('resolveUncertain', () => {
  const attempt = (age = 300_000) => ({ attemptId: ATTEMPT, createdAt: ago(age), amount: TOTAL, currency: 'SAR' })

  it('adopts the match: the invoice id, URL and expiry go to payment_attempt_created', async () => {
    const match = mine()
    client.listInvoices.mockResolvedValue(list([match]))
    expect(await resolveUncertain(deps(), attempt())).toEqual({ kind: 'adopted', url: match.url })
    expect(called('payment_attempt_created')[0]!.args).toEqual({
      p_attempt: ATTEMPT,
      p_invoice_id: match.id,
      p_invoice_url: match.url,
      p_expires_at: '2026-10-02T12:20:00.000Z',
    })
  })

  it('a match needs the invoice\'s own attempt id, the attempt\'s amount and its currency', async () => {
    client.listInvoices.mockResolvedValue(
      list([
        mine({ amount: TOTAL + 1 }),
        mine({ amount: TOTAL - 100 }),
        mine({ currency: 'USD' }),
        mine({ metadata: { order_number: ORDER_NUMBER, attempt_id: randomUUID() } }),
        mine({ metadata: { order_number: ORDER_NUMBER } }),
        mine({ metadata: {} }),
        // The provider's filter ignored: every invoice of the account comes back, including another order's.
        invoiceOf({ id: randomUUID(), metadata: { order_number: 'ZZZZ2345', attempt_id: randomUUID() } }),
        invoiceOf({ id: randomUUID() }),
      ]),
    )
    expect(await resolveUncertain(deps(), attempt(5_000))).toEqual({ kind: 'young' })
    expect(await resolveUncertain(deps(), attempt(300_000))).toEqual({ kind: 'abandoned' })
    expect(called('payment_attempt_created')).toHaveLength(0)
  })

  it('a metadata that was dropped by the provider is no match, however many invoices come back', async () => {
    client.listInvoices.mockResolvedValue(list([invoiceOf({ id: randomUUID() }), invoiceOf({ id: randomUUID() })]))
    expect(await resolveUncertain(deps(), attempt(300_000))).toEqual({ kind: 'abandoned' })
    expect(called('payment_attempt_duplicates')).toHaveLength(0)
  })

  it('one real match among foreign invoices is adopted, and only that one', async () => {
    const match = mine()
    client.listInvoices.mockResolvedValue(list([invoiceOf({ id: randomUUID() }), match, mine({ amount: 1 })]))
    expect(await resolveUncertain(deps(), attempt())).toEqual({ kind: 'adopted', url: match.url })
    expect(called('payment_attempt_created')[0]!.args.p_invoice_id).toBe(match.id)
  })

  it('the sixty second line: 59 seconds is young, 61 is old', async () => {
    client.listInvoices.mockResolvedValue(list([]))
    expect(await resolveUncertain(deps(), attempt(59_000))).toEqual({ kind: 'young' })
    expect(await resolveUncertain(deps(), attempt(61_000))).toEqual({ kind: 'abandoned' })
    expect(await resolveUncertain(deps(), { ...attempt(), createdAt: 'not a date' })).toEqual({ kind: 'young' })
  })

  it('abandons with the code CREATE_ABSENT and never begins an attempt', async () => {
    client.listInvoices.mockResolvedValue(list([]))
    await resolveUncertain(deps(), attempt())
    expect(called('payment_attempt_close')).toEqual([
      { fn: 'payment_attempt_close', args: { p_attempt: ATTEMPT, p_status: 'abandoned', p_error: 'CREATE_ABSENT' } },
    ])
    expect(called('payment_attempt_begin')).toHaveLength(0)
    expect(client.createInvoice).not.toHaveBeenCalled()
  })

  it('reads the next page while there is one, and finds a match there', async () => {
    const match = mine()
    client.listInvoices.mockResolvedValueOnce(list([invoiceOf({ id: randomUUID() })], 2)).mockResolvedValueOnce(list([match]))
    expect(await resolveUncertain(deps(), attempt())).toEqual({ kind: 'adopted', url: match.url })
    expect(client.listInvoices.mock.calls.map(([input]) => (input as { page: number }).page)).toEqual([1, 2])
  })

  it('five pages are the most it reads: past them absence is not proven, so nothing is abandoned', async () => {
    client.listInvoices.mockImplementation(async ({ page }: { page: number }) => list([invoiceOf({ id: randomUUID() })], page + 1))
    expect(await resolveUncertain(deps(), attempt())).toEqual({ kind: 'unavailable' })
    expect(client.listInvoices).toHaveBeenCalledTimes(5)
    expect(called('payment_attempt_close')).toHaveLength(0)
  })

  it('a page that fails after a good one is unavailable', async () => {
    client.listInvoices.mockResolvedValueOnce(list([], 2)).mockResolvedValueOnce(bad('unavailable'))
    expect(await resolveUncertain(deps(), attempt())).toEqual({ kind: 'unavailable' })
  })

  it('a match found on one page and another on the next is a duplicate', async () => {
    client.listInvoices.mockResolvedValueOnce(list([mine()], 2)).mockResolvedValueOnce(list([mine()]))
    expect(await resolveUncertain(deps(), attempt())).toEqual({ kind: 'duplicates' })
    expect(called('payment_attempt_duplicates')).toHaveLength(1)
  })

  it('a ledger refusal after the match is closed, with the invoice cancelled', async () => {
    const match = mine()
    reply('payment_attempt_created', { ok: false, code: 'ATTEMPT_CLOSED' })
    client.listInvoices.mockResolvedValue(list([match]))
    expect(await resolveUncertain(deps(), attempt())).toEqual({ kind: 'closed' })
    expect(client.cancelInvoice).toHaveBeenCalledWith(match.id)
  })
})

// ---- settling -----------------------------------------------------------------------------------------------

describe('settlePayment', () => {
  it('records the outcome of the event and answers it; the job passes the live flag it stored', async () => {
    providerPaid({ outcome: 'already_paid' })
    expect(await settlePayment(deps(), PAYMENT_ID, null, EVENT_ID)).toBe('already_paid')
    expect(called('apply_verified_payment')[0]!.args).toMatchObject({ p_live: null, p_event_id: EVENT_ID })
    expect(called('payment_event_result')[0]!.args).toEqual({ p_event_id: EVENT_ID, p_outcome: 'already_paid', p_error: null })
  })

  it('answers retry for a failure and unknown_payment for a 404', async () => {
    client.fetchPayment.mockResolvedValueOnce(bad('unavailable')).mockResolvedValueOnce(bad('not_found', 404))
    expect(await settlePayment(deps(), PAYMENT_ID, false, EVENT_ID)).toBe('retry')
    expect(await settlePayment(deps(), PAYMENT_ID, false, EVENT_ID)).toBe('unknown_payment')
  })

  it('p_mode is the configured mode, the live flag is the webhook\'s', async () => {
    providerPaid({ outcome: 'not_paid' })
    await settlePayment(deps({ config: { ...config, mode: 'live' } }), PAYMENT_ID, true, EVENT_ID)
    expect(called('apply_verified_payment')[0]!.args).toMatchObject({ p_mode: 'live', p_live: true })
  })
})

describe('settleInvoice', () => {
  const second = '22222222-2222-4222-8222-222222222222'
  const third = '33333333-3333-4333-8333-333333333333'

  it('applies every charged payment the invoice lists, each fetched on its own', async () => {
    const listed = [
      { id: PAYMENT_ID, status: 'failed' },
      { id: second, status: 'paid' },
      { id: third, status: 'refunded' },
      { id: randomUUID(), status: 'captured' },
      { id: randomUUID(), status: 'initiated' },
      { id: randomUUID(), status: 'authorized' },
      { id: randomUUID(), status: 'verified' },
      { id: randomUUID(), status: 'voided' },
    ]
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'initiated', payments: listed })))
    client.fetchPayment.mockImplementation(async (id: string) => good(paymentOf({ id, status: listed.find((p) => p.id === id)!.status })))
    reply('apply_verified_payment', { outcome: 'not_paid' })
    const report = await settleInvoice(deps(), ATTEMPT, INVOICE_ID, 'job')
    expect(client.fetchPayment.mock.calls.map(([id]) => id)).toEqual([second, third, listed[3]!.id])
    expect(called('apply_verified_payment').map((call) => (call.args.p_payment as { id: string }).id)).toEqual([second, third, listed[3]!.id])
    expect(report).toEqual({ outcomes: ['not_paid', 'not_paid', 'not_paid'], error: null })
  })

  it('applies the charged payments oldest first, whatever order the provider lists them in; one with no time goes last', async () => {
    const timeless = randomUUID()
    // The provider's lists are newest first (contract section 2).
    const listed = [
      { id: timeless, status: 'paid' },
      { id: third, status: 'paid' },
      { id: second, status: 'paid' },
    ]
    const at: Record<string, string | null> = { [second]: '2026-10-02T10:00:00.000Z', [third]: '2026-10-02T10:05:00.000Z', [timeless]: null }
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid', payments: listed })))
    client.fetchPayment.mockImplementation(async (id: string) => good(paymentOf({ id, status: 'paid', createdAt: at[id] ?? null })))
    reply('apply_verified_payment', { outcome: 'paid' })
    await settleInvoice(deps(), ATTEMPT, INVOICE_ID, 'job')
    expect(called('apply_verified_payment').map((call) => (call.args.p_payment as { id: string }).id)).toEqual([second, third, timeless])
  })

  it('an invoice the provider calls paid that nothing settled is a FAILED check, so the owner is alerted in the end, never filed as expired', async () => {
    // It lists no payment at all (the documentation does not promise the list), or every apply was refused.
    for (const status of ['paid', 'refunded']) {
      calls.length = 0
      client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status, payments: [] })))
      expect(await settleInvoice(deps(), ATTEMPT, INVOICE_ID, 'job')).toEqual({ outcomes: [], error: 'INVOICE_PAID_UNSETTLED' })
      expect(called('payment_attempt_checked')[0]!.args).toEqual({
        p_attempt: ATTEMPT,
        p_source: 'job',
        p_ok: false,
        p_provider_status: null,
        p_error: 'INVOICE_PAID_UNSETTLED',
      })
    }
  })

  it('hands the SQL the fetched objects, the invoice id asked about, and no live flag or event id', async () => {
    providerPaid({ outcome: 'not_paid' })
    await settleInvoice(deps(), ATTEMPT, INVOICE_ID, 'prompt')
    expect(called('apply_verified_payment')[0]!.args).toEqual({
      p_invoice_id: INVOICE_ID,
      p_payment: normalizedPayment,
      p_invoice: { id: INVOICE_ID, status: 'paid', amount: TOTAL, currency: 'SAR' },
      p_mode: 'test',
      p_live: null,
      p_event_id: null,
    })
  })

  it.each(['paid', 'already_paid', 'paid_needs_resolution', 'review'])('after %s the attempt is settled: no check is recorded', async (outcome) => {
    providerPaid({ outcome })
    const report = await settleInvoice(deps(), ATTEMPT, INVOICE_ID, 'job')
    expect(report.outcomes).toEqual([outcome])
    expect(called('payment_attempt_checked')).toHaveLength(0)
  })

  it.each(['not_paid', 'rejected', 'unknown_invoice'])('after %s the check is still recorded, so no attempt is leased for ever; on a paid invoice it is a failed one', async (outcome) => {
    providerPaid({ outcome })
    for (const source of ['job', 'prompt'] as const) {
      calls.length = 0
      await settleInvoice(deps(), ATTEMPT, INVOICE_ID, source)
      expect(called('payment_attempt_checked')).toEqual([
        {
          fn: 'payment_attempt_checked',
          args: { p_attempt: ATTEMPT, p_source: source, p_ok: false, p_provider_status: null, p_error: 'INVOICE_PAID_UNSETTLED' },
        },
      ])
    }
  })

  it('an invoice with no payment is a good check with its status', async () => {
    for (const status of ['initiated', 'canceled', 'expired']) {
      calls.length = 0
      client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status })))
      expect(await settleInvoice(deps(), ATTEMPT, INVOICE_ID, 'job')).toEqual({ outcomes: [], error: null })
      expect(called('payment_attempt_checked')[0]!.args).toEqual({ p_attempt: ATTEMPT, p_source: 'job', p_ok: true, p_provider_status: status, p_error: null })
    }
    expect(client.fetchPayment).not.toHaveBeenCalled()
  })

  it.each([
    ['not_found', bad('not_found', 404), 'INVOICE_FETCH_NOT_FOUND'],
    ['unavailable', bad('unavailable'), 'INVOICE_FETCH_UNAVAILABLE'],
    ['rate_limited', bad('rate_limited', 429), 'INVOICE_FETCH_RATE_LIMITED'],
    ['refused', bad('refused', 403), 'INVOICE_FETCH_REFUSED'],
  ])('an invoice that cannot be fetched (%s) is a failed check, never "not paid"', async (_label, result, error) => {
    client.fetchInvoice.mockResolvedValue(result)
    expect(await settleInvoice(deps(), ATTEMPT, INVOICE_ID, 'job')).toEqual({ outcomes: [], error })
    expect(called('payment_attempt_checked')).toEqual([
      { fn: 'payment_attempt_checked', args: { p_attempt: ATTEMPT, p_source: 'job', p_ok: false, p_provider_status: null, p_error: error } },
    ])
    expect(called('apply_verified_payment')).toHaveLength(0)
  })

  it('a payment that cannot be fetched is a failed check; the others are still applied', async () => {
    const listed = [{ id: PAYMENT_ID, status: 'paid' }, { id: second, status: 'paid' }]
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid', payments: listed })))
    client.fetchPayment.mockResolvedValueOnce(bad('unavailable')).mockResolvedValueOnce(good(paymentOf({ id: second })))
    reply('apply_verified_payment', { outcome: 'not_paid' })
    const report = await settleInvoice(deps(), ATTEMPT, INVOICE_ID, 'job')
    expect(report).toEqual({ outcomes: ['not_paid'], error: 'PAYMENT_FETCH_UNAVAILABLE' })
    expect(called('apply_verified_payment')).toHaveLength(1)
    expect(called('payment_attempt_checked')[0]!.args).toEqual({
      p_attempt: ATTEMPT,
      p_source: 'job',
      p_ok: false,
      p_provider_status: null,
      p_error: 'PAYMENT_FETCH_UNAVAILABLE',
    })
  })

  it('when another payment settled the attempt a failed fetch records nothing: it is paid', async () => {
    const listed = [{ id: PAYMENT_ID, status: 'paid' }, { id: second, status: 'paid' }]
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid', payments: listed })))
    client.fetchPayment.mockResolvedValueOnce(good(paymentOf())).mockResolvedValueOnce(bad('unavailable'))
    reply('apply_verified_payment', { outcome: 'paid' })
    expect(await settleInvoice(deps(), ATTEMPT, INVOICE_ID, 'job')).toEqual({ outcomes: ['paid'], error: 'PAYMENT_FETCH_UNAVAILABLE' })
    expect(called('payment_attempt_checked')).toHaveLength(0)
  })

  it('a second charged payment on a paid invoice is applied too, so it becomes a review payment', async () => {
    const listed = [{ id: PAYMENT_ID, status: 'paid' }, { id: second, status: 'paid' }]
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid', payments: listed })))
    client.fetchPayment.mockImplementation(async (id: string) => good(paymentOf({ id })))
    reply('apply_verified_payment', { outcome: 'paid' }, { outcome: 'review', reason: 'SECOND_PAYMENT' })
    expect((await settleInvoice(deps(), ATTEMPT, INVOICE_ID, 'job')).outcomes).toEqual(['paid', 'review'])
  })

  it('an apply that raises is a failed check APPLY_FAILED', async () => {
    providerPaid(sqlError('22023'))
    expect(await settleInvoice(deps(), ATTEMPT, INVOICE_ID, 'job')).toEqual({ outcomes: [], error: 'APPLY_FAILED' })
    expect(called('payment_attempt_checked')[0]!.args).toMatchObject({ p_ok: false, p_error: 'APPLY_FAILED', p_provider_status: null })
  })
})

// ---- the reconciliation job ---------------------------------------------------------------------------------

describe('runPaymentsReconcile', () => {
  const claimed = (over: Record<string, unknown> = {}) => ({
    attemptId: randomUUID(),
    status: 'pending',
    providerInvoiceId: randomUUID(),
    orderNumber: ORDER_NUMBER,
    orderPaid: false,
    createdAt: ago(600_000),
    amount: TOTAL,
    currency: 'SAR',
    ...over,
  })
  const claim = (attempts: unknown[] = [], events: unknown[] = [], refunds: unknown[] = []) => reply('payment_reconcile_claim', { attempts, events, refunds })
  const run = () => runPaymentsReconcile(deps())
  const counts = (over: Record<string, number> = {}) => ({ attempts: 0, events: 0, settled: 0, cancelled: 0, errors: 0, skipped: 0, ...over })

  it('claims for the configured mode and records one run with counts only', async () => {
    claim()
    expect(await run()).toEqual({ job: 'payments_reconcile', status: 'ok', ...counts() })
    expect(calls[0]).toEqual({ fn: 'payment_reconcile_claim', args: { p_mode: 'test' } })
    expect(called('job_run_record')).toEqual([
      {
        fn: 'job_run_record',
        args: { p_job: 'payments_reconcile', p_status: 'ok', p_detail: counts(), p_started_at: expect.any(String) },
      },
    ])
    expect(providerCalls()).toBe(0)
  })

  it('the job record never holds an id, a number or a message: counts only', async () => {
    const row = claimed()
    claim([row], [{ eventId: EVENT_ID, paymentId: PAYMENT_ID, live: false }])
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ id: row.providerInvoiceId })))
    client.fetchPayment.mockResolvedValue(bad('unavailable'))
    await run()
    const detail = called('job_run_record')[0]!.args.p_detail as Record<string, unknown>
    expect(Object.values(detail).every((value) => typeof value === 'number')).toBe(true)
    expect(JSON.stringify(called('job_run_record'))).not.toContain(row.providerInvoiceId)
  })

  const uncertain = (over: Record<string, unknown> = {}) => claimed({ status: 'uncertain', providerInvoiceId: null, attemptId: ATTEMPT, ...over })

  it('an uncertain attempt is adopted when the provider holds its invoice, and never begins a new attempt', async () => {
    const match = mine()
    claim([uncertain()])
    client.listInvoices.mockResolvedValue(list([match]))
    const summary = await run()
    expect(summary).toMatchObject({ status: 'ok', attempts: 1, errors: 0 })
    expect(called('payment_attempt_created')[0]!.args).toMatchObject({ p_attempt: ATTEMPT, p_invoice_id: match.id })
    expect(client.fetchInvoice).not.toHaveBeenCalled()
    expect(called('payment_attempt_begin')).toHaveLength(0)
    expect(client.createInvoice).not.toHaveBeenCalled()
  })

  it('an invoice of another attempt is not adopted: the old uncertain attempt is abandoned, and no new one is begun', async () => {
    const row = uncertain({ attemptId: randomUUID() })
    claim([row])
    client.listInvoices.mockResolvedValue(list([mine()])) // ATTEMPT's invoice, not this attempt's
    await run()
    expect(called('payment_attempt_created')).toHaveLength(0)
    expect(called('payment_attempt_close')[0]!.args).toEqual({ p_attempt: row.attemptId, p_status: 'abandoned', p_error: 'CREATE_ABSENT' })
    expect(called('payment_attempt_begin')).toHaveLength(0)
  })

  it('an uncertain attempt that is young is left alone; one whose list failed backs off as a failed check', async () => {
    const young = uncertain({ createdAt: ago(5_000) })
    claim([young])
    client.listInvoices.mockResolvedValue(list([]))
    expect(await run()).toMatchObject({ status: 'ok', errors: 0 })
    expect(called('payment_attempt_close')).toHaveLength(0)
    expect(called('payment_attempt_checked')).toHaveLength(0)

    calls.length = 0
    client.listInvoices.mockResolvedValue(bad('unavailable'))
    expect(await run()).toMatchObject({ status: 'failed', errors: 1 })
    expect(called('payment_attempt_checked')).toEqual([
      { fn: 'payment_attempt_checked', args: { p_attempt: young.attemptId, p_source: 'job', p_ok: false, p_provider_status: null, p_error: 'INVOICE_LIST_FAILED' } },
    ])
  })

  it('an uncertain attempt with two matching invoices is alerted and backs off', async () => {
    claim([uncertain()])
    client.listInvoices.mockResolvedValue(list([mine(), mine()]))
    await run()
    expect(called('payment_attempt_duplicates')[0]!.args).toEqual({ p_attempt: ATTEMPT })
    expect(called('payment_attempt_checked')[0]!.args).toMatchObject({ p_attempt: ATTEMPT, p_source: 'job', p_ok: true })
  })

  it('a pending attempt of an already paid order is cancelled at the provider and closed cancelled', async () => {
    const row = claimed({ orderPaid: true })
    claim([row])
    client.cancelInvoice.mockResolvedValue(good(invoiceOf({ id: row.providerInvoiceId, status: 'canceled' })))
    expect(await run()).toMatchObject({ status: 'ok', attempts: 1, cancelled: 1, settled: 0 })
    expect(client.cancelInvoice).toHaveBeenCalledWith(row.providerInvoiceId)
    expect(called('payment_attempt_close')).toEqual([
      { fn: 'payment_attempt_close', args: { p_attempt: row.attemptId, p_status: 'cancelled', p_error: null } },
    ])
    expect(client.fetchInvoice).not.toHaveBeenCalled()
  })

  it.each([
    ['a refusal (the invoice is paid)', bad('refused', 400)],
    ['an invoice that says it is paid', good(invoiceOf({ status: 'paid' }))],
    ['a canceled invoice that lists a charged payment', good(invoiceOf({ status: 'canceled', payments: [{ id: PAYMENT_ID, status: 'paid' }] }))],
    ['an unreachable provider', bad('unavailable')],
  ])('when the cancel is %s the attempt is settled like any other', async (_label, cancelled) => {
    const row = claimed({ orderPaid: true })
    claim([row])
    client.cancelInvoice.mockResolvedValue(cancelled)
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ id: row.providerInvoiceId, status: 'paid', payments: [{ id: PAYMENT_ID, status: 'paid' }] })))
    client.fetchPayment.mockResolvedValue(good(paymentOf({ invoiceId: row.providerInvoiceId })))
    reply('apply_verified_payment', { outcome: 'review', reason: 'ORDER_ALREADY_PAID' })
    await run()
    expect(called('payment_attempt_close')).toHaveLength(0)
    expect(called('apply_verified_payment')[0]!.args).toMatchObject({ p_invoice_id: row.providerInvoiceId })
  })

  it('only a pending attempt of a paid order is cancelled: an unpaid order or another status is settled', async () => {
    const unpaid = claimed()
    const closed = claimed({ status: 'expired', orderPaid: true })
    claim([unpaid, closed])
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'expired' })))
    await run()
    expect(client.cancelInvoice).not.toHaveBeenCalled()
    expect(called('payment_attempt_checked').map((call) => call.args.p_attempt)).toEqual([unpaid.attemptId, closed.attemptId])
  })

  it('every other attempt with an invoice id goes through settleInvoice as the job, and a payment it settles is counted', async () => {
    const row = claimed()
    claim([row])
    providerPaid({ outcome: 'paid' })
    expect(await run()).toMatchObject({ status: 'ok', attempts: 1, settled: 1, errors: 0 })
    expect(client.fetchInvoice).toHaveBeenCalledWith(row.providerInvoiceId)
    expect(called('apply_verified_payment')[0]!.args).toMatchObject({ p_invoice_id: row.providerInvoiceId, p_live: null, p_event_id: null })
  })

  it('a closed attempt\'s last check is a good check as the job (the SQL then clears its due time)', async () => {
    const row = claimed({ status: 'expired' })
    claim([row])
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ id: row.providerInvoiceId, status: 'expired' })))
    await run()
    expect(called('payment_attempt_checked')[0]!.args).toEqual({
      p_attempt: row.attemptId,
      p_source: 'job',
      p_ok: true,
      p_provider_status: 'expired',
      p_error: null,
    })
  })

  it('an attempt with no invoice id that is not uncertain gets a good check and no provider call', async () => {
    const row = claimed({ status: 'creating', providerInvoiceId: null })
    claim([row])
    expect(await run()).toMatchObject({ status: 'ok', attempts: 1, errors: 0 })
    expect(called('payment_attempt_checked')).toEqual([
      { fn: 'payment_attempt_checked', args: { p_attempt: row.attemptId, p_source: 'job', p_ok: true, p_provider_status: null, p_error: null } },
    ])
    expect(providerCalls()).toBe(0)
  })

  it('a failed fetch is an error of the run: the attempt backs off and the run is partial or failed, never ok', async () => {
    const rows = [claimed(), claimed()]
    claim(rows)
    client.fetchInvoice.mockResolvedValueOnce(bad('unavailable')).mockResolvedValueOnce(good(invoiceOf({ id: rows[1]!.providerInvoiceId })))
    expect(await run()).toMatchObject({ status: 'partial', attempts: 2, errors: 1 })
  })

  it('after a 429 it stops calling the provider for the rest of the run, and the rest keep their lease', async () => {
    const rows = [claimed(), claimed(), claimed()]
    const events = [
      { eventId: randomUUID(), paymentId: randomUUID(), live: false },
      { eventId: randomUUID(), paymentId: randomUUID(), live: false },
    ]
    claim(rows, events)
    client.fetchInvoice.mockResolvedValue(bad('rate_limited', 429))
    const summary = await run()
    expect(summary).toMatchObject({ status: 'partial', attempts: 3, events: 2, errors: 1, skipped: 4 })
    expect(providerCalls()).toBe(1)
    // The row that met the 429 backs off; the others are neither checked nor closed.
    expect(called('payment_attempt_checked')).toEqual([
      { fn: 'payment_attempt_checked', args: { p_attempt: rows[0]!.attemptId, p_source: 'job', p_ok: false, p_provider_status: null, p_error: 'INVOICE_FETCH_RATE_LIMITED' } },
    ])
    expect(called('payment_event_result')).toHaveLength(0)
    expect(called('job_run_record')[0]!.args).toMatchObject({ p_status: 'partial', p_detail: counts({ attempts: 3, events: 2, errors: 1, skipped: 4 }) })
  })

  it('a 429 on a cancel, a list or a payment fetch stops the run the same way', async () => {
    claim([claimed({ orderPaid: true }), claimed()])
    client.cancelInvoice.mockResolvedValue(bad('rate_limited', 429))
    await run()
    // The cancel met the limit; its attempt is settled like any other, which the limit then refuses without a call.
    expect(client.cancelInvoice).toHaveBeenCalledTimes(1)
    expect(client.fetchInvoice).not.toHaveBeenCalled()
    expect(providerCalls()).toBe(1)

    calls.length = 0
    client.cancelInvoice.mockReset()
    client.listInvoices.mockResolvedValue(bad('rate_limited', 429))
    claim([uncertain(), claimed()])
    expect(await run()).toMatchObject({ skipped: 1 })
    expect(client.fetchInvoice).not.toHaveBeenCalled()

    calls.length = 0
    client.listInvoices.mockReset()
    claim([claimed()], [{ eventId: EVENT_ID, paymentId: PAYMENT_ID, live: false }, { eventId: randomUUID(), paymentId: randomUUID(), live: false }])
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid', payments: [{ id: PAYMENT_ID, status: 'paid' }] })))
    client.fetchPayment.mockResolvedValue(bad('rate_limited', 429))
    expect(await run()).toMatchObject({ errors: 1, skipped: 2 })
    expect(client.fetchPayment).toHaveBeenCalledTimes(1)
  })

  it('events: the other mode is closed mode_mismatch, no payment id is closed no_payment_id, the rest settle with the stored live flag', async () => {
    const wrongMode = { eventId: randomUUID(), paymentId: randomUUID(), live: true }
    const noPayment = { eventId: randomUUID(), paymentId: null, live: false }
    const real = { eventId: EVENT_ID, paymentId: PAYMENT_ID, live: false }
    const unknownLive = { eventId: randomUUID(), paymentId: PAYMENT_ID, live: null }
    claim([], [wrongMode, noPayment, real, unknownLive])
    providerPaid({ outcome: 'paid' })
    expect(await run()).toMatchObject({ status: 'ok', events: 4, settled: 2, errors: 0 })
    expect(called('payment_event_result').map((call) => [call.args.p_event_id, call.args.p_outcome])).toEqual([
      [wrongMode.eventId, 'mode_mismatch'],
      [noPayment.eventId, 'no_payment_id'],
      [EVENT_ID, 'paid'],
      [unknownLive.eventId, 'paid'],
    ])
    expect(called('apply_verified_payment').map((call) => [call.args.p_live, call.args.p_event_id])).toEqual([
      [false, EVENT_ID],
      [null, unknownLive.eventId],
    ])
    expect(client.fetchPayment).toHaveBeenCalledTimes(2)
  })

  it('an event whose provider fetch failed is retry: an error of the run', async () => {
    claim([], [{ eventId: EVENT_ID, paymentId: PAYMENT_ID, live: false }])
    client.fetchPayment.mockResolvedValue(bad('unavailable'))
    expect(await run()).toMatchObject({ status: 'failed', errors: 1 })
    expect(called('payment_event_result')[0]!.args).toEqual({ p_event_id: EVENT_ID, p_outcome: 'retry', p_error: 'PAYMENT_FETCH_UNAVAILABLE' })
  })

  it('the refunds of the claim are left alone until round 6: no provider call, no refund function', async () => {
    claim([], [], [{ refundId: randomUUID(), providerPaymentId: PAYMENT_ID }])
    expect(await run()).toMatchObject({ status: 'ok', ...counts() })
    expect(providerCalls()).toBe(0)
    expect(names()).toEqual(['payment_reconcile_claim', 'job_run_record'])
  })

  it('a row that throws is an error and the run goes on with the next', async () => {
    const rows = [claimed(), claimed()]
    claim(rows)
    client.fetchInvoice.mockRejectedValueOnce(new Error('reset')).mockResolvedValueOnce(good(invoiceOf({ id: rows[1]!.providerInvoiceId })))
    expect(await run()).toMatchObject({ status: 'partial', attempts: 2, errors: 1 })
    // The row that threw still backs off and can reach the terminal rule: a failed check is recorded for it.
    const checks = called('payment_attempt_checked')
    expect(checks).toHaveLength(2)
    expect(checks[0]!.args).toEqual({ p_attempt: rows[0]!.attemptId, p_source: 'job', p_ok: false, p_provider_status: null, p_error: 'ROW_FAILED' })
    expect(checks[1]!.args).toMatchObject({ p_attempt: rows[1]!.attemptId, p_ok: true })
  })

  it('once the run has used its time it takes no more rows: they keep their lease and the run is still recorded', async () => {
    const rows = [claimed(), claimed(), claimed()]
    claim(rows)
    const clock = vi.spyOn(Date, 'now')
    const base = 1_800_000_000_000
    let now = base
    clock.mockImplementation(() => now)
    // The first row's provider call uses up the whole budget.
    client.fetchInvoice.mockImplementationOnce(async () => {
      now = base + 61_000
      return good(invoiceOf({ id: rows[0]!.providerInvoiceId }))
    })
    try {
      expect(await run()).toMatchObject({ status: 'partial', attempts: 3, skipped: 2, errors: 0 })
      expect(client.fetchInvoice).toHaveBeenCalledTimes(1)
      expect(called('job_run_record')).toHaveLength(1)
    } finally {
      clock.mockRestore()
    }
  })

  it('a claim that fails is a failed run, and it is still recorded', async () => {
    reply('payment_reconcile_claim', sqlError('08006'))
    expect(await run()).toMatchObject({ status: 'failed', ...counts() })
    expect(called('job_run_record')[0]!.args).toMatchObject({ p_status: 'failed' })
    expect(providerCalls()).toBe(0)
  })

  it('a record that cannot be written makes the run failed, and nothing is thrown', async () => {
    claim()
    reply('job_run_record', sqlError('08006'))
    expect(await run()).toMatchObject({ status: 'failed' })
  })

  it('repeating a settled attempt changes nothing: the SQL answers already_paid and no check is recorded', async () => {
    const row = claimed()
    claim([row])
    providerPaid({ outcome: 'already_paid' })
    for (let round = 0; round < 2; round += 1) {
      expect(await run()).toMatchObject({ status: 'ok', settled: 0, errors: 0 })
    }
    expect(called('payment_attempt_checked')).toHaveLength(0)
  })
})

// ---- the outbox function runs the job -----------------------------------------------------------------------

describe('the payments_reconcile job through the outbox function', () => {
  const request = (body: string, authorization = 'Bearer local-jobs-secret') =>
    new Request('http://127.0.0.1:54321/functions/v1/outbox', {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body,
    })
  const unconfigure = () => {
    for (const name of ['MOYASAR_API_BASE_URL', 'MOYASAR_SECRET_KEY', 'MOYASAR_WEBHOOK_SECRET', 'PAYMENTS_MODE', 'FUNCTIONS_PUBLIC_URL']) {
      vi.stubEnv(name, '')
    }
  }

  beforeEach(() => {
    vi.stubEnv('JOBS_SECRET', 'local-jobs-secret')
  })

  it('without the jobs bearer it is 401 and nothing runs', async () => {
    const response = await handleJobs(request('{"job":"payments_reconcile"}', 'Bearer wrong'), rpc, undefined, deps())
    expect(response.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('runs the reconciliation and answers the same shape as the other jobs', async () => {
    reply('payment_reconcile_claim', { attempts: [], events: [], refunds: [] })
    const response = await handleJobs(request('{"job":"payments_reconcile"}'), rpc, undefined, deps())
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      ok: true,
      data: [{ job: 'payments_reconcile', status: 'ok', attempts: 0, events: 0, settled: 0, cancelled: 0, errors: 0, skipped: 0 }],
    })
    expect(names()).toEqual(['payment_reconcile_claim', 'job_run_record'])
  })

  it('while payments are not configured it records a skipped run with the reason, and touches nothing else', async () => {
    unconfigure()
    const response = await handleJobs(request('{"job":"payments_reconcile"}'), rpc)
    expect(response.status).toBe(200)
    expect(await json(response)).toMatchObject({ ok: true, data: [{ job: 'payments_reconcile', status: 'skipped', reason: 'PAYMENTS_NOT_CONFIGURED' }] })
    expect(calls).toEqual([
      {
        fn: 'job_run_record',
        args: { p_job: 'payments_reconcile', p_status: 'skipped', p_detail: { reason: 'PAYMENTS_NOT_CONFIGURED' }, p_started_at: expect.any(String) },
      },
    ])
  })

  it('a skipped run still answers when the database cannot record it', async () => {
    unconfigure()
    reply('job_run_record', sqlError('08006'))
    const response = await handleJobs(request('{"job":"payments_reconcile"}'), rpc)
    expect(response.status).toBe(200)
    expect(await json(response)).toMatchObject({ data: [{ status: 'skipped' }] })
  })
})

// ---- what the doubles never receive -------------------------------------------------------------------------

describe('secrets, tokens and bodies', () => {
  it('no flow hands the database or the provider a secret, a key, a clear token or a body, and nothing is logged', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))
    const TOKEN = 'L'.repeat(43)
    const raw = JSON.stringify(webhookBody({ data: { id: PAYMENT_ID, status: 'paid', source: { number: '4201XXXXXXXX1010', message: 'APPROVED' } } }))

    providerPaid()
    await handlePayments(post('/webhook', raw), deps())
    await handlePayments(post('/webhook', webhookBody({ secret_token: 'forged' })), deps())
    reply('payment_callback_begin', { check: { attemptId: ATTEMPT, providerInvoiceId: INVOICE_ID } })
    await handlePayments(post('/callback', { id: INVOICE_ID, secret_token: WEBHOOK_SECRET }, { 'cf-connecting-ip': '203.0.113.9' }), deps())
    reply('payment_check_begin', { state: 'pending', hasToken: true, check: { attemptId: ATTEMPT, providerInvoiceId: INVOICE_ID } })
    reply('payment_state', { state: 'paid', hasToken: true })
    await verifyPost({ action: 'verify', orderNumber: ORDER_NUMBER, accessToken: TOKEN })
    reply('payment_attempt_begin', NEW)
    client.createInvoice.mockResolvedValue(good(invoiceOf({ metadata: { order_number: ORDER_NUMBER, attempt_id: ATTEMPT } }), 201))
    await startPayment(deps(), INPUT)
    reply('payment_reconcile_claim', { attempts: [{ attemptId: ATTEMPT, status: 'pending', providerInvoiceId: INVOICE_ID, orderPaid: false, createdAt: ago(1), amount: TOTAL, currency: 'SAR' }], events: [], refunds: [] })
    await runPaymentsReconcile(deps())

    const everything = JSON.stringify({ calls, provider: Object.values(client).map((fn) => fn.mock.calls) })
    for (const secret of [WEBHOOK_SECRET, SECRET_KEY, TOKEN, 'forged', '4201XXXXXXXX1010', 'APPROVED', 'account_name']) {
      expect(everything, secret).not.toContain(secret)
    }
    // The payload hash is a hash of the raw body, 64 hex characters, and nothing else of it is kept.
    expect(called('payment_event_record')[0]!.args.p_payload_hash).toBe(sha256(raw))
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})
