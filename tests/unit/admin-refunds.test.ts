// P08 round 6: the `admin` function's three refund actions (`refund-create`,
// `refund-recheck`, `refund-record-external`, supabase/functions/_shared/refunds.ts)
// with every dependency faked: staff identity, the database, the Moyasar client.
// The SQL side is proven in tests/integration/refunds.test.ts, and the real
// function against the emulator in tests/integration/refunds-http.test.ts; what is
// proven here is every branch of the handlers: who may, the fetch-first rule, the
// replay that reaches the provider once, each provider answer mapped to its
// `refund_result` outcome, the refusals and what is (never) in an answer.
import { createHash, randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleAdmin, type MediaStore } from '../../supabase/functions/_shared/admin.ts'
import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import type { PaymentDeps } from '../../supabase/functions/_shared/payments.ts'
import type { MoyasarClient, MoyasarPayment, MoyasarResult, PaymentsConfigOk } from '../../supabase/functions/_shared/payments/moyasar.ts'
import type { StaffIdentity } from '../../supabase/functions/_shared/staff.ts'

const USER = '11111111-1111-4111-8111-111111111111'
const ORDER = randomUUID()
const ATTEMPT = randomUUID()
const INVOICE = randomUUID()
const PAYMENT = randomUUID()
const REVIEW = randomUUID()
const REFUND = randomUUID()
const KEY = randomUUID()
const RETURN = randomUUID()
const ITEM_A = randomUUID()
const ITEM_B = randomUUID()
const TOTAL = 12_500
const SECRET_KEY = 'sk_test_local_emulator_key_not_for_production'
const WEBHOOK_SECRET = 'local-moyasar-webhook-secret-not-for-production'

const config: PaymentsConfigOk = {
  ok: true,
  baseUrl: 'http://127.0.0.1:54390/v1',
  secretKey: SECRET_KEY,
  webhookSecret: WEBHOOK_SECRET,
  mode: 'test',
  callbackBase: 'http://127.0.0.1:54321/functions/v1',
  storageBase: 'http://127.0.0.1:54321/storage/v1',
}

// ---- the doubles --------------------------------------------------------------------------------------------

type Call = { fn: string; args: Record<string, unknown> }
const calls: Call[] = []
const script = new Map<string, unknown[]>()
const reply = (fn: string, ...values: unknown[]): void => void script.set(fn, values)
const rpc: Rpc = async (fn, args) => {
  calls.push({ fn, args })
  const values = script.get(fn) ?? []
  const value = values.length > 1 ? values.shift() : values[0]
  if (value instanceof Error) throw value
  return value ?? null
}
const names = (): string[] => calls.map((call) => call.fn)
const called = (fn: string): Call[] => calls.filter((call) => call.fn === fn)
const sqlError = (code: string): Error => Object.assign(new Error('sql: connection to server at 10.0.0.5 lost'), { code })

const client = {
  createInvoice: vi.fn(),
  fetchInvoice: vi.fn(),
  listInvoices: vi.fn(),
  cancelInvoice: vi.fn(),
  fetchPayment: vi.fn(),
  refundPayment: vi.fn(),
}
const payments = (over: Partial<PaymentDeps> = {}): PaymentDeps => ({ rpc, client: client as unknown as MoyasarClient, config, ...over })
const good = <T>(data: T, status = 200): MoyasarResult<T> => ({ ok: true, status, data })
const bad = (kind: 'refused' | 'not_found' | 'rate_limited' | 'unavailable' | 'uncertain', status?: number): MoyasarResult<never> => ({
  ok: false,
  kind,
  ...(status === undefined ? {} : { status }),
})
const paymentOf = (over: Partial<MoyasarPayment> = {}): MoyasarPayment => ({
  id: PAYMENT,
  status: 'paid',
  amount: TOTAL,
  currency: 'SAR',
  fee: 150,
  refunded: 0,
  invoiceId: INVOICE,
  createdAt: null,
  sourceType: 'creditcard',
  sourceCompany: 'mada',
  ...over,
})

const memoryStore = (): MediaStore => ({ signedUpload: vi.fn(), read: vi.fn(), write: vi.fn(), move: vi.fn(), remove: vi.fn() })
const staffAs = (role: StaffIdentity['role'] | 'none', recentTotp = true) => async (): Promise<StaffIdentity | null> =>
  role === 'none' ? null : { userId: USER, role, recentTotp }

const post = (body: unknown): Request =>
  new Request('http://127.0.0.1:54321/functions/v1/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer staff-token' },
    body: JSON.stringify(body),
  })
const send = (
  body: unknown,
  opts: { role?: StaffIdentity['role'] | 'none'; recentTotp?: boolean; payments?: PaymentDeps | null } = {},
): Promise<Response> =>
  handleAdmin(post(body), {
    rpc,
    staff: staffAs(opts.role === undefined ? 'owner' : opts.role, opts.recentTotp ?? true),
    store: memoryStore(),
    ...(opts.payments === null ? {} : { payments: opts.payments ?? payments() }),
  })
const answer = async (response: Response): Promise<{ status: number; body: any }> => ({ status: response.status, body: await response.json() })

/** A valid `refund-create` of 5 000 halalas: 4 000 of one item and 1 000 of the shipping. */
const create = (over: Record<string, unknown> = {}) => ({
  action: 'refund-create',
  orderId: ORDER,
  attemptId: ATTEMPT,
  amount: 5000,
  reason: 'عيب في الطباعة',
  allocation: { items: [{ itemId: ITEM_A, amount: 4000 }], shipping: 1000 },
  idempotencyKey: KEY,
  ...over,
})
const createForReview = (over: Record<string, unknown> = {}) => ({
  action: 'refund-create',
  reviewPaymentId: REVIEW,
  amount: 5000,
  reason: 'دفعة بمبلغ خاطئ',
  allocation: {},
  idempotencyKey: KEY,
  ...over,
})
const recheck = (over: Record<string, unknown> = {}) => ({ action: 'refund-recheck', refundId: REFUND, ...over })
const external = (over: Record<string, unknown> = {}) => ({ action: 'refund-record-external', attemptId: ATTEMPT, reason: 'استرداد من لوحة بوابة الدفع', ...over })

const attemptRef = (over: Record<string, unknown> = {}) => ({
  ok: true,
  attemptId: ATTEMPT,
  status: 'paid',
  providerInvoiceId: INVOICE,
  providerPaymentId: PAYMENT,
  orderNumber: 'ABCD2345',
  createdAt: '2026-10-02T10:00:00.000Z',
  amount: TOTAL,
  currency: 'SAR',
  ...over,
})
const NEW = { ok: true, state: 'new', refundId: REFUND, providerPaymentId: PAYMENT, amount: 5000 }

beforeEach(() => {
  calls.length = 0
  script.clear()
  for (const fn of Object.values(client)) fn.mockReset().mockResolvedValue(bad('unavailable'))
  reply('payment_attempt_ref', attemptRef())
  reply('refund_request', NEW)
  reply('refund_result', { ok: true, refundId: REFUND, status: 'succeeded', amount: 5000 })
  reply('refund_ref', { ok: true, refundId: REFUND, status: 'uncertain', providerPaymentId: PAYMENT })
  reply('refund_settle', { ok: true, refundId: REFUND, status: 'succeeded', amount: 5000 })
  reply('refund_record_external', { ok: true, refundId: REFUND, status: 'succeeded', amount: 3000 })
  client.fetchPayment.mockResolvedValue(good(paymentOf()))
  client.refundPayment.mockResolvedValue(good(paymentOf({ status: 'refunded', refunded: 5000 })))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const ACTIONS: Array<[string, () => unknown]> = [
  ['refund-create', create],
  ['refund-recheck', recheck],
  ['refund-record-external', external],
]

// ---- who may -----------------------------------------------------------------------------------------------

describe('refund actions: who may', () => {
  it.each(ACTIONS)('%s is for an owner only: nobody else reaches the database or the provider', async (_action, body) => {
    for (const role of ['editor', 'operations', null] as const) {
      const refused = await answer(await send(body(), { role }))
      expect(refused.status, String(role)).toBe(403)
      expect(refused.body).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    }
    expect((await send(body(), { role: 'none' })).status).toBe(401)
    expect(calls).toHaveLength(0)
    expect(client.fetchPayment).not.toHaveBeenCalled()
    expect(client.refundPayment).not.toHaveBeenCalled()
  })

  it.each([
    ['refund-create', create],
    ['refund-record-external', external],
  ])('%s needs a fresh TOTP: an owner whose last one is old is refused before anything is called', async (_action, body) => {
    const stale = await answer(await send(body(), { recentTotp: false }))
    expect(stale.status).toBe(403)
    expect(stale.body).toMatchObject({ ok: false, error: { code: 'STEP_UP_REQUIRED' } })
    expect(calls).toHaveLength(0)
    expect(client.fetchPayment).not.toHaveBeenCalled()
  })

  it('refund-recheck needs no step-up: it only reads the provider and settles what it holds', async () => {
    expect((await send(recheck(), { recentTotp: false })).status).toBe(200)
  })

  it('an owner revoked a moment ago is refused by the SQL: 403, never a leak', async () => {
    reply('payment_attempt_ref', sqlError('42501'))
    const refused = await answer(await send(create()))
    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({ error: { code: 'FORBIDDEN', message: 'هذا الإجراء للمالك فقط.' } })
    reply('refund_ref', sqlError('42501'))
    expect((await send(recheck())).status).toBe(403)
    reply('refund_request', sqlError('42501'))
    reply('payment_attempt_ref', attemptRef())
    expect((await send(create())).status).toBe(403)
    reply('refund_record_external', sqlError('42501'))
    expect((await send(external())).status).toBe(403)
    expect(client.refundPayment).not.toHaveBeenCalled()
  })

  it('without payments configured every action is 503 PAYMENTS_NOT_CONFIGURED and touches nothing', async () => {
    for (const name of ['MOYASAR_API_BASE_URL', 'MOYASAR_SECRET_KEY', 'MOYASAR_WEBHOOK_SECRET', 'PAYMENTS_MODE', 'FUNCTIONS_PUBLIC_URL']) vi.stubEnv(name, '')
    for (const [action, body] of ACTIONS) {
      const refused = await answer(await send(body(), { payments: null }))
      expect(refused.status, action).toBe(503)
      expect(refused.body).toMatchObject({ error: { code: 'PAYMENTS_NOT_CONFIGURED' } })
    }
    expect(calls).toHaveLength(0)
  })
})

// ---- validation ---------------------------------------------------------------------------------------------

describe('refund-create: the request is validated before anything is called', () => {
  it.each([
    ['no target', { attemptId: undefined }],
    ['an attempt and a review payment', { reviewPaymentId: REVIEW }],
    ['an attempt without its order', { orderId: undefined }],
    ['an order that is not a uuid', { orderId: 'ABCD2345' }],
    ['an uppercase uuid', { attemptId: ATTEMPT.toUpperCase() }],
    ['a review payment that is not a uuid', { attemptId: undefined, orderId: undefined, reviewPaymentId: 'pay-1' }],
    ['no amount', { amount: undefined }],
    ['a zero amount', { amount: 0 }],
    ['a negative amount', { amount: -5 }],
    ['a fractional amount', { amount: 50.5 }],
    ['an amount sent as text', { amount: '5000' }],
    ['an amount beyond the database integer', { amount: 2_147_483_648 }],
    ['no reason', { reason: undefined }],
    ['a reason of spaces', { reason: '   ' }],
    ['a reason over 300 characters', { reason: 'ا'.repeat(301) }],
    ['a reason with a control character', { reason: 'سطر\nثانٍ' }],
    ['no allocation', { allocation: undefined }],
    ['an allocation with an unknown key', { allocation: { items: [], shipping: 0, note: 'x' } }],
    ['an allocation item with an unknown key', { allocation: { items: [{ itemId: ITEM_A, amount: 5000, extra: 1 }] } }],
    ['an allocation item that is not a uuid', { allocation: { items: [{ itemId: 'item-1', amount: 5000 }] } }],
    ['a zero item amount', { allocation: { items: [{ itemId: ITEM_A, amount: 0 }], shipping: 5000 } }],
    ['a fractional item amount', { allocation: { items: [{ itemId: ITEM_A, amount: 4999.5 }], shipping: 0 } }],
    ['a negative shipping', { allocation: { items: [], shipping: -1 } }],
    ['more than 50 allocation items', { allocation: { items: Array.from({ length: 51 }, () => ({ itemId: randomUUID(), amount: 1 })) } }],
    ['no idempotency key', { idempotencyKey: undefined }],
    ['an idempotency key that is not a uuid', { idempotencyKey: 'abc' }],
    ['a return id that is not a uuid', { returnId: 'RET-1' }],
    ['a confirmed total below zero', { expectedRefunded: -1 }],
    ['a fractional confirmed total', { expectedRefunded: 1.5 }],
    ['a confirmed total sent as text', { expectedRefunded: '0' }],
    ['a confirmed total of ten digits (the SQL takes nine)', { expectedRefunded: 1_000_000_000 }],
    ['a null confirmed total', { expectedRefunded: null }],
    ['an unknown field', { provider: 'moyasar' }],
    ['a smuggled provider payment id', { paymentId: PAYMENT }],
  ])('refuses %s with 422 INVALID', async (_label, over) => {
    const refused = await answer(await send(create(over)))
    expect(refused.status).toBe(422)
    expect(refused.body).toMatchObject({ ok: false, error: { code: 'INVALID' } })
    expect(calls).toHaveLength(0)
    expect(client.fetchPayment).not.toHaveBeenCalled()
  })

  it.each([
    ['refund-recheck without an id', recheck({ refundId: undefined })],
    ['refund-recheck with an id that is not a uuid', recheck({ refundId: 'refund-1' })],
    ['refund-recheck with an unknown field', recheck({ attemptId: ATTEMPT })],
    ['refund-record-external with no target', external({ attemptId: undefined })],
    ['refund-record-external with two targets', external({ reviewPaymentId: REVIEW })],
    ['refund-record-external with no reason', external({ reason: undefined })],
    ['refund-record-external with an amount (the provider decides it)', external({ amount: 100 })],
  ])('%s is 422 and nothing is called', async (_label, body) => {
    expect((await send(body)).status).toBe(422)
    expect(calls).toHaveLength(0)
    expect(client.fetchPayment).not.toHaveBeenCalled()
  })

  it('accepts the shapes it must: an attempt, a review payment with or without its order, an allocation of items only or shipping only', async () => {
    for (const body of [
      create(),
      create({ allocation: { items: [{ itemId: ITEM_A, amount: 5000 }] } }),
      create({ allocation: { shipping: 5000 } }),
      create({ returnId: RETURN }),
      create({ expectedRefunded: 0 }),
      create({ expectedRefunded: 999_999_999 }),
      createForReview(),
      createForReview({ orderId: ORDER }),
      createForReview({ expectedRefunded: 4000 }),
    ]) {
      const accepted = await send(body)
      expect(accepted.status, JSON.stringify(body)).toBe(200)
    }
  })
})

// ---- refund-create: the order of the calls -------------------------------------------------------------------

describe('refund-create: fetch first, reserve, one provider call, record', () => {
  it('a paying attempt: the owner and the configured mode ask for its payment id, the provider total is fetched, then it reserves and refunds', async () => {
    client.fetchPayment.mockResolvedValue(good(paymentOf({ status: 'refunded', refunded: 0 })))
    const done = await answer(await send(create()))
    expect(done).toEqual({ status: 200, body: { ok: true, data: { refundId: REFUND, status: 'succeeded', amount: 5000 } } })
    expect(names()).toEqual(['payment_attempt_ref', 'refund_request', 'refund_result'])
    expect(called('payment_attempt_ref')[0]!.args).toEqual({ p_actor: USER, p_attempt: ATTEMPT, p_mode: 'test' })
    expect(client.fetchPayment).toHaveBeenCalledExactlyOnceWith(PAYMENT)
    expect(client.refundPayment).toHaveBeenCalledExactlyOnceWith(PAYMENT, 5000)
    // The total is read before anything is written, and the refund is made only after the reservation.
    expect(client.fetchPayment.mock.invocationCallOrder[0]!).toBeLessThan(client.refundPayment.mock.invocationCallOrder[0]!)
    expect(called('refund_request')[0]!.args).toEqual({
      p_actor: USER,
      p_order: ORDER,
      p_attempt: ATTEMPT,
      p_review_payment: null,
      p_amount: 5000,
      p_reason: 'عيب في الطباعة',
      p_allocation: { items: [{ itemId: ITEM_A, amount: 4000 }], shipping: 1000 },
      p_idempotency_key: KEY,
      p_request_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_return: null,
      p_provider_refunded: 0,
    })
    expect(called('refund_result')[0]!.args).toEqual({ p_refund: REFUND, p_outcome: 'succeeded', p_provider_refunded: 5000, p_error: null })
  })

  it('hands the SQL the total the provider showed, so a refund made outside is seen by the SQL and not hidden here', async () => {
    client.fetchPayment.mockResolvedValue(good(paymentOf({ status: 'refunded', refunded: 1200 })))
    reply('refund_request', { ok: false, code: 'PROVIDER_AHEAD' })
    const refused = await answer(await send(create()))
    expect(called('refund_request')[0]!.args.p_provider_refunded).toBe(1200)
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ ok: false, error: { code: 'PROVIDER_AHEAD' } })
    expect(client.refundPayment).not.toHaveBeenCalled()
    expect(called('refund_result')).toHaveLength(0)
  })

  it('a review payment is its own provider payment id: no attempt lookup, an empty allocation, the order only when given', async () => {
    const done = await answer(await send(createForReview()))
    expect(done.status).toBe(200)
    expect(names()).toEqual(['refund_request', 'refund_result'])
    expect(client.fetchPayment).toHaveBeenCalledExactlyOnceWith(REVIEW)
    expect(called('refund_request')[0]!.args).toMatchObject({
      p_order: null,
      p_attempt: null,
      p_review_payment: REVIEW,
      p_allocation: {},
      p_return: null,
    })
    reply('refund_request', { ...NEW, providerPaymentId: REVIEW })
    calls.length = 0
    await send(createForReview({ orderId: ORDER, returnId: RETURN }))
    expect(called('refund_request')[0]!.args).toMatchObject({ p_order: ORDER, p_return: RETURN })
    expect(client.refundPayment).toHaveBeenLastCalledWith(REVIEW, 5000)
  })

  it('a review payment with items or shipping in its allocation is sent as given: the SQL refuses it (INVALID_ALLOCATION)', async () => {
    reply('refund_request', { ok: false, code: 'INVALID_ALLOCATION' })
    const refused = await answer(await send(createForReview({ allocation: { shipping: 100 } })))
    expect(called('refund_request')[0]!.args.p_allocation).toEqual({ items: [], shipping: 100 })
    expect(refused).toMatchObject({ status: 422, body: { error: { code: 'INVALID_ALLOCATION' } } })
  })

  it('an attempt that is not paid, or has no payment id, is NOT_REFUNDABLE before any fetch, and an unknown one is 404', async () => {
    for (const over of [{ status: 'pending', providerPaymentId: null }, { status: 'review' }, { status: 'expired' }, { providerPaymentId: null }]) {
      reply('payment_attempt_ref', attemptRef(over))
      const refused = await answer(await send(create()))
      expect(refused.status, JSON.stringify(over)).toBe(409)
      expect(refused.body).toMatchObject({ error: { code: 'NOT_REFUNDABLE' } })
    }
    reply('payment_attempt_ref', { ok: false, code: 'NOT_FOUND' })
    expect((await answer(await send(create()))).status).toBe(404)
    expect(client.fetchPayment).not.toHaveBeenCalled()
    expect(called('refund_request')).toHaveLength(0)
  })

  it.each([
    ['unavailable', bad('unavailable')],
    ['refused (a 4xx other than 401 and 403)', bad('refused', 400)],
    ['refused before it was sent (an id that is no uuid)', bad('refused')],
    ['rate limited', bad('rate_limited', 429)],
    ['uncertain', bad('uncertain')],
  ])('a fetch that is %s answers 503 and writes nothing: no reservation, no refund call', async (_label, fetched) => {
    client.fetchPayment.mockResolvedValue(fetched)
    for (const body of [create(), createForReview()]) {
      calls.length = 0
      const refused = await answer(await send(body))
      expect(refused.status).toBe(503)
      expect(refused.body).toMatchObject({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE' } })
    }
    expect(called('refund_request')).toHaveLength(0)
    expect(called('refund_result')).toHaveLength(0)
    expect(client.refundPayment).not.toHaveBeenCalled()
  })

  // F1-11: a payment the configured key cannot see (a 404) will not appear by trying again: 404, never "try later".
  it('a payment the provider does not know answers 404 NOT_FOUND and writes nothing: no reservation, no refund call', async () => {
    client.fetchPayment.mockResolvedValue(bad('not_found', 404))
    for (const body of [create(), createForReview()]) {
      calls.length = 0
      const refused = await answer(await send(body))
      expect(refused.status).toBe(404)
      expect(refused.body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', message: 'لم تُعثر على الدفعة لدى بوابة الدفع.' } })
    }
    expect(called('refund_request')).toHaveLength(0)
    expect(called('refund_result')).toHaveLength(0)
    expect(client.refundPayment).not.toHaveBeenCalled()
  })

  // FABLE-AUDIT F3-16 (f), QUALITY-02: a key the provider refuses is not a passing outage, and «حاول بعد قليل» would be a lie.
  it.each([401, 403])('a fetch the provider refuses with %i answers 502 PROVIDER_REFUSED in its own words and writes nothing, whichever refund action asked', async (status) => {
    client.fetchPayment.mockResolvedValue(bad('refused', status))
    for (const body of [create(), createForReview(), recheck(), external()]) {
      calls.length = 0
      const refused = await answer(await send(body))
      expect(refused.status, JSON.stringify(body)).toBe(502)
      expect(refused.body).toMatchObject({ ok: false, error: { code: 'PROVIDER_REFUSED', message: 'رفضت بوابة الدفع المفتاح؛ تحقق من إعدادات الدفع.' } })
      expect(refused.body.error.message).not.toContain('حاول بعد قليل')
      for (const written of ['refund_request', 'refund_result', 'refund_settle', 'refund_record_external']) expect(called(written), written).toHaveLength(0)
    }
    expect(client.refundPayment).not.toHaveBeenCalled()
  })

  // The refund call itself refused with a 401 keeps the money state it always had: the refund is failed, nothing moved.
  it('a refund call the provider refuses with 401 is still a failed refund, recorded with its status', async () => {
    client.refundPayment.mockResolvedValue(bad('refused', 401))
    reply('refund_result', { ok: true, refundId: REFUND, status: 'failed', amount: 5000 })
    const done = await answer(await send(create()))
    expect(done).toEqual({ status: 200, body: { ok: true, data: { refundId: REFUND, status: 'failed', amount: 5000 } } })
    expect(called('refund_result')[0]!.args).toEqual({ p_refund: REFUND, p_outcome: 'failed', p_provider_refunded: null, p_error: 'REFUND_REFUSED_401' })
  })

  it('every refusal of the SQL is a stable code and a short Arabic message, and the provider is never asked', async () => {
    const expected: Array<[string, number]> = [
      ['NOT_REFUNDABLE', 409],
      ['REFUND_IN_FLIGHT', 409],
      ['PROVIDER_AHEAD', 409],
      ['PROVIDER_BEHIND', 409],
      ['EXCEEDS_BALANCE', 409],
      ['INVALID_ALLOCATION', 422],
      ['INVALID_RETURN', 422],
      ['IDEMPOTENCY_CONFLICT', 409],
      ['STALE', 409],
    ]
    const messages = new Set<string>()
    for (const [code, status] of expected) {
      reply('refund_request', { ok: false, code })
      const refused = await answer(await send(create()))
      expect(refused.status, code).toBe(status)
      expect(refused.body.error.code).toBe(code)
      expect(refused.body.error.message).toMatch(/[؀-ۿ]/)
      expect(refused.body.error.message).not.toMatch(/[–—٠-٩۰-۹]/)
      messages.add(refused.body.error.message)
    }
    expect(messages.size).toBe(expected.length)
    expect(client.refundPayment).not.toHaveBeenCalled()
    expect(called('refund_result')).toHaveLength(0)
    // A code this file does not know is still a refusal that carries its code, never a success.
    reply('refund_request', { ok: false, code: 'SOMETHING_NEW' })
    expect(await answer(await send(create()))).toMatchObject({ status: 409, body: { ok: false, error: { code: 'SOMETHING_NEW' } } })
  })

  it('a replay answers the stored refund and never reaches the provider\'s refund route: the same key twice refunds once', async () => {
    reply('refund_request', NEW, { ok: true, state: 'duplicate', refundId: REFUND, status: 'succeeded', amount: 5000 })
    const first = await answer(await send(create()))
    const second = await answer(await send(create()))
    expect(first.body.data).toEqual({ refundId: REFUND, status: 'succeeded', amount: 5000 })
    expect(second).toEqual({ status: 200, body: { ok: true, data: { refundId: REFUND, status: 'succeeded', amount: 5000 } } })
    expect(client.refundPayment).toHaveBeenCalledTimes(1)
    expect(called('refund_result')).toHaveLength(1)
    // The same request, the same key and the same hash both times: the SQL is what tells a replay from a new request.
    const [one, two] = called('refund_request')
    expect(two!.args).toEqual(one!.args)
    expect(one!.args.p_idempotency_key).toBe(KEY)
  })

  it.each(['submitting', 'uncertain', 'failed'])('a replay of a refund that is %s answers it as stored and does not retry the provider', async (status) => {
    reply('refund_request', { ok: true, state: 'duplicate', refundId: REFUND, status, amount: 5000 })
    expect(await answer(await send(create()))).toEqual({ status: 200, body: { ok: true, data: { refundId: REFUND, status, amount: 5000 } } })
    expect(client.refundPayment).not.toHaveBeenCalled()
    expect(called('refund_result')).toHaveLength(0)
  })

  it('the request hash is canonical: the order of the items does not matter, every other part of the request does', async () => {
    const hash = async (over: Record<string, unknown>): Promise<unknown> => {
      calls.length = 0
      await send(create(over))
      return called('refund_request')[0]!.args.p_request_hash
    }
    const items = [{ itemId: ITEM_A, amount: 2000 }, { itemId: ITEM_B, amount: 2000 }]
    const base = await hash({ allocation: { items, shipping: 1000 } })
    expect(await hash({ allocation: { items: [...items].reverse(), shipping: 1000 } })).toBe(base)
    // An absent shipping is a zero shipping, an item with the same facts is the same item.
    expect(await hash({ allocation: { items: [...items].reverse() }, amount: 4000 })).toBe(await hash({ allocation: { items, shipping: 0 }, amount: 4000 }))
    const others = [
      { allocation: { items, shipping: 1000 }, amount: 4999 },
      { allocation: { items, shipping: 1000 }, reason: 'سبب آخر' },
      { allocation: { items, shipping: 999 } },
      { allocation: { items: [{ itemId: ITEM_A, amount: 2001 }, items[1]], shipping: 1000 } },
      { allocation: { items: [{ itemId: ITEM_A, amount: 2000 }, { itemId: randomUUID(), amount: 2000 }], shipping: 1000 } },
      { allocation: { items, shipping: 1000 }, returnId: RETURN },
      { allocation: { items, shipping: 1000 }, attemptId: randomUUID() },
      { allocation: { items, shipping: 1000 }, orderId: randomUUID() },
    ]
    const seen = new Set<unknown>([base])
    for (const over of others) seen.add(await hash(over))
    expect(seen.size).toBe(others.length + 1)
    // The key is not part of the hash: it is what the SQL compares the hash by.
    expect(await hash({ allocation: { items, shipping: 1000 }, idempotencyKey: randomUUID() })).toBe(base)
  })
})

// ---- refund-create: the confirmed total the screen was built from ---------------------------------------------

// FABLE-AUDIT F3-2 (ADMIN-COMMERCE-05): `refund_request` answers STALE when `p_allocation.expectedRefunded` is not the
// confirmed total of the attempt (or review payment). The function only carries it; the SQL compares it.
describe('refund-create: expectedRefunded', () => {
  const requested = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    calls.length = 0
    await send(body)
    return called('refund_request')[0]!.args
  }

  it('travels inside the allocation of an attempt, beside its items and shipping', async () => {
    expect((await requested(create({ expectedRefunded: 2000 }))).p_allocation).toEqual({
      items: [{ itemId: ITEM_A, amount: 4000 }],
      shipping: 1000,
      expectedRefunded: 2000,
    })
    // Zero is a total, not an absence.
    expect((await requested(create({ expectedRefunded: 0 }))).p_allocation).toMatchObject({ expectedRefunded: 0 })
  })

  it('travels alone in the empty allocation of a review payment, and beside what it was given otherwise', async () => {
    expect((await requested(createForReview({ expectedRefunded: 4000 }))).p_allocation).toEqual({ expectedRefunded: 4000 })
    expect((await requested(createForReview({ allocation: { shipping: 100 }, expectedRefunded: 7 }))).p_allocation).toEqual({
      items: [],
      shipping: 100,
      expectedRefunded: 7,
    })
  })

  it('is absent when it was not sent: the allocation is exactly what it was, for an attempt and for a review payment', async () => {
    expect((await requested(create())).p_allocation).toEqual({ items: [{ itemId: ITEM_A, amount: 4000 }], shipping: 1000 })
    expect((await requested(createForReview())).p_allocation).toEqual({})
    expect('expectedRefunded' in ((await requested(create())).p_allocation as object)).toBe(false)
  })

  it('is part of the request hash when sent, and a request without it hashes as it always did', async () => {
    const hash = async (over: Record<string, unknown>): Promise<unknown> => (await requested(create(over))).p_request_hash
    // The hash of a request with no confirmed total is the digest of its canonical text before this field existed.
    const before = JSON.stringify({
      order: ORDER,
      attempt: ATTEMPT,
      review: null,
      amount: 5000,
      reason: 'عيب في الطباعة',
      allocation: { items: [{ itemId: ITEM_A, amount: 4000 }], shipping: 1000 },
      returnId: null,
    })
    expect(await hash({})).toBe(createHash('sha256').update(before).digest('hex'))
    const none = await hash({})
    const zero = await hash({ expectedRefunded: 0 })
    const some = await hash({ expectedRefunded: 2000 })
    expect(new Set([none, zero, some]).size).toBe(3)
    // The same total is the same request again, which is what lets a replay with the kept total be recognised.
    expect(await hash({ expectedRefunded: 2000 })).toBe(some)
    expect(await hash({ expectedRefunded: 2000, idempotencyKey: randomUUID() })).toBe(some)
  })

  it('a stale total is 409 STALE in its own words: nothing is reserved, the provider is not asked, nothing is recorded', async () => {
    reply('refund_request', { ok: false, code: 'STALE', refunded: 3000 })
    for (const body of [create({ expectedRefunded: 0 }), createForReview({ expectedRefunded: 0 })]) {
      calls.length = 0
      const refused = await answer(await send(body))
      expect(refused.status).toBe(409)
      expect(refused.body).toMatchObject({
        ok: false,
        error: { code: 'STALE', message: 'تغيّر المسترد منذ فتحت هذه الصفحة؛ راجع جدول الاستردادات ثم أعد المحاولة.' },
      })
      // The ledger's total is for the screen to read again, not for this answer to carry.
      expect(JSON.stringify(refused.body)).not.toContain('3000')
      expect(called('refund_result')).toHaveLength(0)
    }
    expect(client.refundPayment).not.toHaveBeenCalled()
  })

  it('a replay of a refund made under a total that has since moved is the stored refund, whatever the SQL was told to expect', async () => {
    reply('refund_request', { ok: true, state: 'duplicate', refundId: REFUND, status: 'succeeded', amount: 5000 })
    const replayed = await answer(await send(create({ expectedRefunded: 0 })))
    expect(replayed).toEqual({ status: 200, body: { ok: true, data: { refundId: REFUND, status: 'succeeded', amount: 5000 } } })
    expect(client.refundPayment).not.toHaveBeenCalled()
    expect(called('refund_result')).toHaveLength(0)
  })

  it('a malformed total reaching the SQL (22023) is 422 INVALID, like any malformed call', async () => {
    reply('refund_request', sqlError('22023'))
    expect((await answer(await send(create({ expectedRefunded: 5 })))).status).toBe(422)
    expect(client.refundPayment).not.toHaveBeenCalled()
  })
})

// ---- refund-create: what the provider answered --------------------------------------------------------------

describe('refund-create: every provider answer becomes the outcome the SQL is told', () => {
  const outcome = async (refunded: MoyasarResult<MoyasarPayment> | Error) => {
    if (refunded instanceof Error) client.refundPayment.mockRejectedValue(refunded)
    else client.refundPayment.mockResolvedValue(refunded)
    calls.length = 0
    await send(create())
    const [result] = called('refund_result')
    return result!.args
  }

  it('a 2xx carries the new total: succeeded with exactly that total', async () => {
    expect(await outcome(good(paymentOf({ status: 'refunded', refunded: 5000 })))).toEqual({
      p_refund: REFUND,
      p_outcome: 'succeeded',
      p_provider_refunded: 5000,
      p_error: null,
    })
    // Whatever total comes back is handed over untouched: the SQL, not this file, decides if it is the right one.
    expect((await outcome(good(paymentOf({ refunded: 7777 })))).p_provider_refunded).toBe(7777)
  })

  // F1-11: a refusal keeps the provider's HTTP status in its code, so the owner can tell a 400 from a 401.
  it.each([
    ['a refusal (400)', bad('refused', 400), 'REFUND_REFUSED_400'],
    ['a refusal (401)', bad('refused', 401), 'REFUND_REFUSED_401'],
    ['a refusal that carried no status', bad('refused'), 'REFUND_REFUSED'],
    ['a payment the provider does not know (404)', bad('not_found', 404), 'REFUND_NOT_FOUND'],
  ])('%s is failed: nothing moved, the balance is free again', async (_label, answered, code) => {
    expect(await outcome(answered)).toEqual({ p_refund: REFUND, p_outcome: 'failed', p_provider_refunded: null, p_error: code })
  })

  it.each([
    ['a timeout or a cut connection (uncertain)', bad('uncertain'), 'REFUND_UNCERTAIN'],
    ['a 5xx (uncertain)', bad('uncertain', 500), 'REFUND_UNCERTAIN'],
    ['a 429', bad('rate_limited', 429), 'REFUND_RATE_LIMITED'],
    ['an unreadable reply (unavailable)', bad('unavailable', 200), 'REFUND_UNAVAILABLE'],
  ])('%s is uncertain: it may have happened, the job settles it', async (_label, answered, code) => {
    expect(await outcome(answered)).toEqual({ p_refund: REFUND, p_outcome: 'uncertain', p_provider_refunded: null, p_error: code })
  })

  it('a client that throws is uncertain, never failed', async () => {
    expect(await outcome(new Error('socket hang up'))).toEqual({ p_refund: REFUND, p_outcome: 'uncertain', p_provider_refunded: null, p_error: 'REFUND_ERROR' })
  })

  it('a 4xx never becomes uncertain and a timeout never becomes failed', async () => {
    const kinds = ['refused', 'not_found', 'rate_limited', 'unavailable', 'uncertain'] as const
    const outcomes: Record<string, string> = {}
    for (const kind of kinds) outcomes[kind] = String((await outcome(bad(kind))).p_outcome)
    expect(outcomes).toEqual({ refused: 'failed', not_found: 'failed', rate_limited: 'uncertain', unavailable: 'uncertain', uncertain: 'uncertain' })
  })

  it('answers what the SQL says about the refund whichever outcome it was: the stored status, the amount, nothing more', async () => {
    reply('refund_result', { ok: true, refundId: REFUND, status: 'failed', amount: 5000 })
    expect(await answer(await send(create()))).toEqual({ status: 200, body: { ok: true, data: { refundId: REFUND, status: 'failed', amount: 5000 } } })
    // The job settled it first: the row is not in flight any more, and the answer is the row as stored.
    reply('refund_result', { ok: false, code: 'NOT_IN_FLIGHT', refundId: REFUND, status: 'succeeded', amount: 5000 })
    expect(await answer(await send(create()))).toEqual({ status: 200, body: { ok: true, data: { refundId: REFUND, status: 'succeeded', amount: 5000 } } })
    reply('refund_result', { ok: false, code: 'NOT_FOUND' })
    expect((await send(create())).status).toBe(404)
    reply('refund_result', null)
    expect((await send(create())).status).toBe(500)
  })

  it('when the result cannot be written the provider has been asked and the row stays in flight for the job: 500, no detail', async () => {
    reply('refund_result', sqlError('08006'))
    const broken = await answer(await send(create()))
    expect(broken.status).toBe(500)
    expect(broken.body).toMatchObject({ ok: false, error: { code: 'FAILED' } })
    expect(JSON.stringify(broken.body)).not.toContain('10.0.0.5')
    expect(client.refundPayment).toHaveBeenCalledTimes(1)
  })

  it('a database failure before the provider call is a detail-free 500, a malformed call 422, and the provider is not asked', async () => {
    reply('refund_request', sqlError('08006'))
    const broken = await answer(await send(create()))
    expect(broken.status).toBe(500)
    expect(JSON.stringify(broken.body)).not.toContain('10.0.0.5')
    reply('refund_request', sqlError('22023'))
    expect((await send(create())).status).toBe(422)
    expect(client.refundPayment).not.toHaveBeenCalled()
  })

  it('the answer holds the refund id, its status and its amount, and no provider id, key or secret', async () => {
    const text = await (await send(create())).text()
    expect(JSON.parse(text)).toEqual({ ok: true, data: { refundId: REFUND, status: 'succeeded', amount: 5000 } })
    for (const secret of [PAYMENT, INVOICE, SECRET_KEY, WEBHOOK_SECRET, ATTEMPT]) expect(text).not.toContain(secret)
  })
})

// ---- refund-recheck -----------------------------------------------------------------------------------------

describe('refund-recheck', () => {
  it('asks for the refund as this owner, fetches its payment, and settles with the fetched total', async () => {
    client.fetchPayment.mockResolvedValue(good(paymentOf({ status: 'refunded', refunded: 5000 })))
    const done = await answer(await send(recheck()))
    expect(done).toEqual({ status: 200, body: { ok: true, data: { refundId: REFUND, status: 'succeeded', amount: 5000 } } })
    expect(names()).toEqual(['refund_ref', 'refund_settle'])
    expect(called('refund_ref')[0]!.args).toEqual({ p_actor: USER, p_refund: REFUND })
    expect(called('refund_settle')[0]!.args).toEqual({ p_refund: REFUND, p_provider_refunded: 5000 })
    expect(client.fetchPayment).toHaveBeenCalledExactlyOnceWith(PAYMENT)
    expect(client.refundPayment).not.toHaveBeenCalled()
  })

  it('an unknown refund is 404 and the provider is not asked', async () => {
    reply('refund_ref', { ok: false, code: 'NOT_FOUND' })
    expect((await answer(await send(recheck()))).status).toBe(404)
    expect(client.fetchPayment).not.toHaveBeenCalled()
  })

  it.each([
    ['unavailable', bad('unavailable')],
    ['refused (a 400)', bad('refused', 400)],
    ['rate limited', bad('rate_limited', 429)],
  ])('a failed fetch (%s) is 503 and settles nothing: a refund is never decided from a read that failed', async (_label, fetched) => {
    client.fetchPayment.mockResolvedValue(fetched)
    const refused = await answer(await send(recheck()))
    expect(refused.status).toBe(503)
    expect(refused.body).toMatchObject({ error: { code: 'PROVIDER_UNAVAILABLE' } })
    expect(names()).toEqual(['refund_ref'])
  })

  it('a payment the provider does not know is 404 NOT_FOUND and settles nothing', async () => {
    client.fetchPayment.mockResolvedValue(bad('not_found', 404))
    const refused = await answer(await send(recheck()))
    expect(refused.status).toBe(404)
    expect(refused.body).toMatchObject({ error: { code: 'NOT_FOUND', message: 'لم تُعثر على الدفعة لدى بوابة الدفع.' } })
    expect(names()).toEqual(['refund_ref'])
  })

  it('a refund that is no longer in flight is answered as stored; one that vanished is 404; a broken reply is 500', async () => {
    reply('refund_settle', { ok: false, code: 'NOT_IN_FLIGHT', refundId: REFUND, status: 'failed', amount: 5000 })
    expect(await answer(await send(recheck()))).toEqual({ status: 200, body: { ok: true, data: { refundId: REFUND, status: 'failed', amount: 5000 } } })
    reply('refund_settle', { ok: false, code: 'NOT_FOUND' })
    expect((await send(recheck())).status).toBe(404)
    reply('refund_settle', null)
    expect((await send(recheck())).status).toBe(500)
  })

  it('a database failure is a detail-free 500', async () => {
    reply('refund_settle', sqlError('08006'))
    const broken = await answer(await send(recheck()))
    expect(broken.status).toBe(500)
    expect(JSON.stringify(broken.body)).not.toContain('10.0.0.5')
  })

  it('the refund of a review payment is fetched by the review payment\'s id', async () => {
    reply('refund_ref', { ok: true, refundId: REFUND, status: 'submitting', providerPaymentId: REVIEW })
    await send(recheck())
    expect(client.fetchPayment).toHaveBeenCalledExactlyOnceWith(REVIEW)
  })
})

// ---- refund-record-external ---------------------------------------------------------------------------------

describe('refund-record-external', () => {
  it('a paying attempt: its payment id from the ledger, the fetched total and status, the owner\'s reason', async () => {
    client.fetchPayment.mockResolvedValue(good(paymentOf({ status: 'refunded', refunded: 3000 })))
    const done = await answer(await send(external()))
    expect(done).toEqual({ status: 200, body: { ok: true, data: { refundId: REFUND, status: 'succeeded', amount: 3000 } } })
    expect(names()).toEqual(['payment_attempt_ref', 'refund_record_external'])
    expect(called('payment_attempt_ref')[0]!.args).toEqual({ p_actor: USER, p_attempt: ATTEMPT, p_mode: 'test' })
    expect(client.fetchPayment).toHaveBeenCalledExactlyOnceWith(PAYMENT)
    expect(called('refund_record_external')[0]!.args).toEqual({
      p_actor: USER,
      p_attempt: ATTEMPT,
      p_review_payment: null,
      p_provider_refunded: 3000,
      p_provider_status: 'refunded',
      p_reason: 'استرداد من لوحة بوابة الدفع',
    })
    expect(client.refundPayment).not.toHaveBeenCalled()
  })

  it('a review payment is its own id; a void is passed on as the status the provider shows', async () => {
    client.fetchPayment.mockResolvedValue(good(paymentOf({ status: 'voided', refunded: 0 })))
    await send(external({ attemptId: undefined, reviewPaymentId: REVIEW }))
    expect(names()).toEqual(['refund_record_external'])
    expect(client.fetchPayment).toHaveBeenCalledExactlyOnceWith(REVIEW)
    expect(called('refund_record_external')[0]!.args).toMatchObject({
      p_attempt: null,
      p_review_payment: REVIEW,
      p_provider_refunded: 0,
      p_provider_status: 'voided',
    })
  })

  it('an attempt that is not paid is NOT_REFUNDABLE and an unknown one 404, with no fetch', async () => {
    reply('payment_attempt_ref', attemptRef({ status: 'review' }))
    expect((await answer(await send(external()))).body).toMatchObject({ error: { code: 'NOT_REFUNDABLE' } })
    reply('payment_attempt_ref', { ok: false, code: 'NOT_FOUND' })
    expect((await send(external())).status).toBe(404)
    expect(client.fetchPayment).not.toHaveBeenCalled()
    expect(called('refund_record_external')).toHaveLength(0)
  })

  it('a failed fetch is 503 and records nothing; a payment the provider does not know is 404 and records nothing', async () => {
    client.fetchPayment.mockResolvedValue(bad('unavailable'))
    const refused = await answer(await send(external()))
    expect(refused.status).toBe(503)
    client.fetchPayment.mockResolvedValue(bad('not_found', 404))
    const unknown = await answer(await send(external()))
    expect(unknown.status).toBe(404)
    expect(unknown.body).toMatchObject({ error: { code: 'NOT_FOUND', message: 'لم تُعثر على الدفعة لدى بوابة الدفع.' } })
    expect(called('refund_record_external')).toHaveLength(0)
  })

  it.each([
    ['NO_DELTA', 409],
    ['REFUND_IN_FLIGHT', 409],
    ['NOT_REFUNDABLE', 409],
    ['EXCEEDS_BALANCE', 409],
  ])('the SQL\'s refusal %s is %i with its code and an Arabic message', async (code, status) => {
    reply('refund_record_external', { ok: false, code })
    const refused = await answer(await send(external()))
    expect(refused.status).toBe(status)
    expect(refused.body).toMatchObject({ ok: false, error: { code } })
    expect(refused.body.error.message).toMatch(/[؀-ۿ]/)
  })

  it('a reply with neither a refund nor a code is a 500, and a database failure a detail-free 500', async () => {
    reply('refund_record_external', null)
    expect((await send(external())).status).toBe(500)
    reply('refund_record_external', sqlError('08006'))
    const broken = await answer(await send(external()))
    expect(broken.status).toBe(500)
    expect(JSON.stringify(broken.body)).not.toContain('10.0.0.5')
  })
})

// ---- what is never logged or leaked --------------------------------------------------------------------------

describe('secrets', () => {
  it('no action logs, and no secret, key or provider id reaches the database or an answer', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))
    client.fetchPayment.mockResolvedValue(good(paymentOf({ refunded: 0 })))
    const texts: string[] = []
    for (const body of [create(), createForReview(), recheck(), external()]) texts.push(await (await send(body)).text())
    const everything = JSON.stringify({ calls, texts })
    for (const secret of [SECRET_KEY, WEBHOOK_SECRET, 'Basic ', 'authorization']) expect(everything, secret).not.toContain(secret)
    // The provider payment id is in the SQL calls (the ledger's own reference) and in none of the answers.
    for (const text of texts) expect(text).not.toContain(PAYMENT)
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })

  // FABLE-AUDIT F3-1: a failed database call leaves its cause and the reply's id, and not one value of the request.
  it('a failed database call logs its function and SQLSTATE, then the reply\'s requestId, and no value of the request or the error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    reply('refund_request', sqlError('08006'))
    const broken = await answer(await send(create()))
    expect(broken.status).toBe(500)
    const lines = error.mock.calls.map(([line]) => JSON.parse(line as string) as Record<string, unknown>)
    expect(lines).toEqual([
      { fn: 'refunds', sqlstate: '08006' },
      { requestId: broken.body.requestId, status: 500, code: 'FAILED' },
    ])
    const text = error.mock.calls.map(([line]) => String(line)).join('\n')
    for (const value of [KEY, ORDER, ATTEMPT, PAYMENT, '10.0.0.5', 'عيب في الطباعة']) expect(text, value).not.toContain(value)
    // A refusal that is the owner's to read, not a fault of ours, logs nothing.
    error.mockClear()
    reply('refund_request', { ok: false, code: 'EXCEEDS_BALANCE' })
    expect((await send(create())).status).toBe(409)
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
