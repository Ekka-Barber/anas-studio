// P08 round 9: the `admin` function's `dispute-record` action (supabase/functions/_shared/disputes.ts)
// with every dependency faked: staff identity, the database, the Moyasar client. The SQL side is proven in
// tests/integration/stats.test.ts, and the real function with a real owner session in
// tests/integration/disputes-http.test.ts; what is proven here is every branch of the handler: who may, the
// step-up that comes before anything is read, each invalid field, the payment settings (only for the mode:
// Moyasar shows no dispute, so the provider is never called), a new row and a repeat, each refusal of the SQL
// mapped to its status and message, and a database failure that leaks nothing.
import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleAdmin, type MediaStore } from '../../supabase/functions/_shared/admin.ts'
import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import type { PaymentDeps } from '../../supabase/functions/_shared/payments.ts'
import type { MoyasarClient, PaymentsConfigOk } from '../../supabase/functions/_shared/payments/moyasar.ts'
import type { StaffIdentity } from '../../supabase/functions/_shared/staff.ts'

const USER = '11111111-1111-4111-8111-111111111111'
const ATTEMPT = randomUUID()
const REVIEW = randomUUID()
const ITEM_A = randomUUID()
const ITEM_B = randomUUID()
const DISPUTE = randomUUID()

const config: PaymentsConfigOk = {
  ok: true,
  baseUrl: 'http://127.0.0.1:54390/v1',
  secretKey: 'sk_test_local_emulator_key_not_for_production',
  webhookSecret: 'local-moyasar-webhook-secret-not-for-production',
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
const providerCalls = (): number => Object.values(client).reduce((sum, fn) => sum + fn.mock.calls.length, 0)

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

/** A valid first row of a chargeback against a paid attempt. */
const record = (over: Record<string, unknown> = {}) => ({
  action: 'dispute-record',
  kind: 'chargeback',
  providerRef: 'CB-2026-0001',
  follows: 0,
  attemptId: ATTEMPT,
  amount: 4500,
  direction: 'against_seller',
  occurredOn: '2026-09-30',
  reason: 'اعترض حامل البطاقة على العملية',
  decision: 'none',
  ...over,
})

const stored = (over: Record<string, unknown> = {}) => ({
  id: DISPUTE,
  kind: 'chargeback',
  providerRef: 'CB-2026-0001',
  seq: 1,
  attemptId: ATTEMPT,
  reviewPaymentId: null,
  environment: 'test',
  amount: 4500,
  direction: 'against_seller',
  occurredOn: '2026-09-30',
  reason: 'اعترض حامل البطاقة على العملية',
  resolution: null,
  decision: 'none',
  itemIds: [],
  createdAt: '2026-10-03T08:00:00.000Z',
  ...over,
})

beforeEach(() => {
  calls.length = 0
  script.clear()
  for (const fn of Object.values(client)) fn.mockReset().mockResolvedValue(null)
  reply('dispute_record', { ok: true, duplicate: false, dispute: stored() })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// ---- who may -----------------------------------------------------------------------------------------------

describe('dispute-record: who may', () => {
  it('is for an owner only: nobody else reaches the database', async () => {
    for (const role of ['editor', 'operations'] as const) {
      const refused = await answer(await send(record(), { role }))
      expect(refused.status, role).toBe(403)
      expect(refused.body).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    }
    expect((await send(record(), { role: 'none' })).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('needs a fresh TOTP, and asks for it before anything is read: an old one is refused even for a request that is malformed or cannot be configured', async () => {
    for (const body of [record(), { action: 'dispute-record' }, record({ amount: -1 })]) {
      const stale = await answer(await send(body, { recentTotp: false }))
      expect(stale.status).toBe(403)
      expect(stale.body).toMatchObject({ ok: false, error: { code: 'STEP_UP_REQUIRED', message: 'أدخل رمز تطبيق المصادقة للمتابعة.' } })
    }
    for (const name of ['MOYASAR_API_BASE_URL', 'MOYASAR_SECRET_KEY', 'MOYASAR_WEBHOOK_SECRET', 'PAYMENTS_MODE', 'FUNCTIONS_PUBLIC_URL']) vi.stubEnv(name, '')
    expect((await answer(await send(record(), { recentTotp: false, payments: null }))).body.error.code).toBe('STEP_UP_REQUIRED')
    expect(calls).toHaveLength(0)
  })

  it('an owner revoked a moment ago is refused by the SQL: 403, never a leak', async () => {
    reply('dispute_record', sqlError('42501'))
    const refused = await answer(await send(record()))
    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', message: 'هذا الإجراء للمالك فقط.' } })
    expect(JSON.stringify(refused.body)).not.toContain('10.0.0.5')
  })

  it('without payment settings it is 503 PAYMENTS_NOT_CONFIGURED and the database is not called', async () => {
    for (const name of ['MOYASAR_API_BASE_URL', 'MOYASAR_SECRET_KEY', 'MOYASAR_WEBHOOK_SECRET', 'PAYMENTS_MODE', 'FUNCTIONS_PUBLIC_URL']) vi.stubEnv(name, '')
    const refused = await answer(await send(record(), { payments: null }))
    expect(refused.status).toBe(503)
    expect(refused.body).toMatchObject({ ok: false, error: { code: 'PAYMENTS_NOT_CONFIGURED' } })
    expect(calls).toHaveLength(0)
  })
})

// ---- validation ---------------------------------------------------------------------------------------------

describe('dispute-record: the request is validated before anything is called', () => {
  const tomorrow = (): string => new Date(Date.now() + 3 * 3_600_000 + 86_400_000).toISOString().slice(0, 10)

  it.each([
    ['no kind', { kind: undefined }],
    ['an unknown kind', { kind: 'refund' }],
    ['no reference', { providerRef: undefined }],
    ['a reference of spaces', { providerRef: '   ' }],
    ['a reference over 120 characters', { providerRef: 'A'.repeat(121) }],
    ['a reference with a line break', { providerRef: 'CB-1\nCB-2' }],
    ['a reference sent as a number', { providerRef: 123 }],
    ['no follows', { follows: undefined }],
    ['a negative follows', { follows: -1 }],
    ['a fractional follows', { follows: 0.5 }],
    ['a follows over 1000', { follows: 1001 }],
    ['a follows sent as text', { follows: '0' }],
    ['an attempt that is not a uuid', { attemptId: 'attempt-1' }],
    ['an uppercase uuid', { attemptId: ATTEMPT.toUpperCase() }],
    ['a review payment that is not a uuid', { attemptId: undefined, reviewPaymentId: 'pay-1' }],
    ['an attempt and a review payment', { reviewPaymentId: REVIEW }],
    ['a chargeback with no target', { attemptId: undefined }],
    ['an `other` with no target', { kind: 'other', attemptId: undefined }],
    ['no amount', { amount: undefined }],
    ['a zero amount', { amount: 0 }],
    ['a negative amount', { amount: -5 }],
    ['a fractional amount', { amount: 50.5 }],
    ['an amount sent as text', { amount: '4500' }],
    ['an amount beyond the database integer', { amount: 2_147_483_648 }],
    ['no direction', { direction: undefined }],
    ['an unknown direction', { direction: 'against' }],
    ['no date', { occurredOn: undefined }],
    ['a date that does not exist', { occurredOn: '2026-02-30' }],
    ['a date in another form', { occurredOn: '30/09/2026' }],
    ['an instant instead of a date', { occurredOn: '2026-09-30T10:00:00Z' }],
    ['a date that is tomorrow', { occurredOn: tomorrow() }],
    ['no reason', { reason: undefined }],
    ['a reason of spaces', { reason: '   ' }],
    ['a reason over 500 characters', { reason: 'ا'.repeat(501) }],
    ['a reason with a line break', { reason: 'سطر\nثانٍ' }],
    ['a resolution of spaces', { resolution: '   ' }],
    ['a resolution over 500 characters', { resolution: 'ا'.repeat(501) }],
    ['a resolution with a control character', { resolution: 'نص\u0007' }],
    ['no decision', { decision: undefined }],
    ['an unknown decision', { decision: 'refunded' }],
    ['items that are not uuids', { decision: 'entitlement_revoked', itemIds: ['item-1'] }],
    ['the same item twice', { decision: 'entitlement_revoked', itemIds: [ITEM_A, ITEM_A] }],
    ['more than 50 items', { decision: 'entitlement_revoked', itemIds: Array.from({ length: 51 }, () => randomUUID()) }],
    ['an item decision with no items', { decision: 'entitlement_revoked' }],
    ['an item decision with an empty list', { decision: 'fulfillment_stopped', itemIds: [] }],
    ['items named for a decision that does not act on them', { decision: 'none', itemIds: [ITEM_A] }],
    ['items named for entitlement_kept', { decision: 'entitlement_kept', itemIds: [ITEM_A] }],
    ['a smuggled mode', { mode: 'live' }],
    ['a smuggled environment', { environment: 'live' }],
    ['an unknown field', { provider: 'moyasar' }],
  ])('refuses %s with 422 INVALID', async (_label, over) => {
    const refused = await answer(await send(record(over)))
    expect(refused.status).toBe(422)
    expect(refused.body).toMatchObject({ ok: false, error: { code: 'INVALID' } })
    expect(calls).toHaveLength(0)
  })

  it('accepts the shapes it must: each kind, either target or none for a payout or a fee difference, the two item decisions, a resolution', async () => {
    for (const body of [
      record(),
      record({ attemptId: undefined, reviewPaymentId: REVIEW }),
      record({ kind: 'payout_difference', attemptId: undefined }),
      record({ kind: 'fee_difference', attemptId: undefined, direction: 'for_seller' }),
      record({ kind: 'fee_difference' }),
      record({ kind: 'other' }),
      record({ follows: 1, resolution: 'ربحنا النزاع', direction: 'for_seller', decision: 'entitlement_kept' }),
      record({ decision: 'entitlement_revoked', itemIds: [ITEM_A, ITEM_B] }),
      record({ decision: 'fulfillment_stopped', itemIds: [ITEM_A] }),
      record({ follows: 1000 }),
      record({ providerRef: 'ا'.repeat(120) }),
    ]) {
      const accepted = await send(body)
      expect(accepted.status, JSON.stringify(body)).toBe(201)
    }
  })

  it('"a real date, not in the future" is the owner\'s own day in Riyadh (UTC+3): today is accepted, tomorrow is not', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 01:30 on 4 October in Riyadh, still 3 October in UTC.
    vi.setSystemTime(new Date('2026-10-03T22:30:00Z'))
    expect((await send(record({ occurredOn: '2026-10-04' }))).status).toBe(201)
    expect((await send(record({ occurredOn: '2026-10-05' }))).status).toBe(422)
    // 23:59:59 on 3 October in Riyadh: the 4th has not begun.
    vi.setSystemTime(new Date('2026-10-03T20:59:59Z'))
    expect((await send(record({ occurredOn: '2026-10-03' }))).status).toBe(201)
    expect((await send(record({ occurredOn: '2026-10-04' }))).status).toBe(422)
  })
})

// ---- the call ----------------------------------------------------------------------------------------------

describe('dispute-record: what reaches the SQL, and what comes back', () => {
  it('hands it the owner, the request and the configured mode, and nothing is asked of the provider', async () => {
    const done = await answer(await send(record({ resolution: 'قيد المراجعة', decision: 'entitlement_revoked', itemIds: [ITEM_A] })))
    expect(done.status).toBe(201)
    expect(called('dispute_record')).toHaveLength(1)
    expect(called('dispute_record')[0]!.args).toEqual({
      p_actor: USER,
      p_kind: 'chargeback',
      p_provider_ref: 'CB-2026-0001',
      p_follows: 0,
      p_attempt: ATTEMPT,
      p_review_payment: null,
      p_amount: 4500,
      p_direction: 'against_seller',
      p_occurred_on: '2026-09-30',
      p_reason: 'اعترض حامل البطاقة على العملية',
      p_resolution: 'قيد المراجعة',
      p_decision: 'entitlement_revoked',
      p_item_ids: [ITEM_A],
      p_environment: 'test',
    })
    expect(providerCalls()).toBe(0)
  })

  it('omitted fields are sent as null and an empty list; a review payment is the target as it is', async () => {
    await send(record({ attemptId: undefined, reviewPaymentId: REVIEW, kind: 'other' }))
    expect(called('dispute_record')[0]!.args).toMatchObject({ p_attempt: null, p_review_payment: REVIEW, p_resolution: null, p_item_ids: [], p_kind: 'other' })
    await send(record({ kind: 'payout_difference', attemptId: undefined }))
    expect(called('dispute_record')[1]!.args).toMatchObject({ p_attempt: null, p_review_payment: null, p_kind: 'payout_difference' })
  })

  it('texts are trimmed before they are sent', async () => {
    await send(record({ providerRef: '  CB-9  ', reason: '  سبب  ', resolution: '  تم  ' }))
    expect(called('dispute_record')[0]!.args).toMatchObject({ p_provider_ref: 'CB-9', p_reason: 'سبب', p_resolution: 'تم' })
  })

  it('the mode is the configured one, never the request\'s', async () => {
    await send(record(), { payments: payments({ config: { ...config, mode: 'live' } }) })
    expect(called('dispute_record')[0]!.args.p_environment).toBe('live')
    // Not injected: the environment decides (test mode here).
    vi.stubEnv('MOYASAR_API_BASE_URL', config.baseUrl)
    vi.stubEnv('MOYASAR_SECRET_KEY', config.secretKey)
    vi.stubEnv('MOYASAR_WEBHOOK_SECRET', config.webhookSecret)
    vi.stubEnv('PAYMENTS_MODE', 'test')
    vi.stubEnv('FUNCTIONS_PUBLIC_URL', config.callbackBase)
    const done = await send(record(), { payments: null })
    expect(done.status).toBe(201)
    expect(called('dispute_record')[1]!.args.p_environment).toBe('test')
  })

  it('a new row is 201 with the stored row, and a repeat is 200 with duplicate: true and the stored row', async () => {
    const created = await answer(await send(record()))
    expect(created).toEqual({ status: 201, body: { ok: true, data: { duplicate: false, dispute: stored() } } })
    reply('dispute_record', { ok: true, duplicate: true, dispute: stored({ amount: 1000, reason: 'سجل سابق' }) })
    const repeated = await answer(await send(record()))
    expect(repeated).toEqual({ status: 200, body: { ok: true, data: { duplicate: true, dispute: stored({ amount: 1000, reason: 'سجل سابق' }) } } })
  })

  it.each([
    ['NOT_FOUND', 404],
    ['NOT_DISPUTABLE', 409],
    ['NO_PREDECESSOR', 409],
    ['TARGET_MISMATCH', 409],
    ['INVALID_ITEMS', 422],
    ['REFERENCE_IN_USE', 409],
    ['SOMETHING_NEW', 409],
  ])('the SQL refusal %s is %i with its own code and a short Arabic message', async (code, status) => {
    reply('dispute_record', { ok: false, code })
    const refused = await answer(await send(record()))
    expect(refused.status).toBe(status)
    expect(refused.body).toMatchObject({ ok: false, error: { code, message: expect.stringMatching(/[؀-ۿ]/) } })
    expect(refused.body.error.message.length).toBeLessThan(80)
  })

  it('a malformed call the SQL refuses is 422; any other database failure is a detail-free 500', async () => {
    reply('dispute_record', sqlError('22023'))
    const malformed = await answer(await send(record()))
    expect(malformed).toMatchObject({ status: 422, body: { error: { code: 'INVALID' } } })
    for (const failure of [sqlError('XX000'), sqlError('23505'), sqlError('40P01'), new Error('connection to 10.0.0.5 refused')]) {
      reply('dispute_record', failure)
      const failed = await answer(await send(record()))
      expect(failed.status).toBe(500)
      expect(failed.body).toMatchObject({ ok: false, error: { code: 'FAILED', message: 'تعذّر إكمال الإجراء.' } })
      expect(JSON.stringify(failed.body)).not.toMatch(/10\.0\.0\.5|sql:|connection/)
    }
    // An answer that is not the SQL's own shape is a failure too, not a success.
    for (const odd of [null, 'ok', { ok: 'yes' }]) {
      reply('dispute_record', odd)
      expect((await send(record())).status).toBe(500)
    }
  })
})
