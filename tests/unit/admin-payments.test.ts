// P08 rounds 3 and 4: the `admin` function's `payment-recheck` action (the
// owner's «أعد الفحص»), the payments part of the `status` action and the
// owner's `commerce-checkout-set` switch, with every dependency faked: staff
// identity, the database, the Moyasar client, storage. The SQL side is proven
// in tests/integration/payment.test.ts and commerce-settings.test.ts, and the
// real function against the emulator in tests/integration/payment-http.test.ts.
import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleAdmin, type MediaStore } from '../../supabase/functions/_shared/admin.ts'
import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import type { PaymentDeps } from '../../supabase/functions/_shared/payments.ts'
import type { MoyasarClient, MoyasarInvoice, MoyasarResult, PaymentsConfigOk } from '../../supabase/functions/_shared/payments/moyasar.ts'
import type { StaffIdentity } from '../../supabase/functions/_shared/staff.ts'

const USER = '11111111-1111-4111-8111-111111111111'
const ATTEMPT = randomUUID()
const INVOICE_ID = randomUUID()
const PAYMENT_ID = randomUUID()
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

const LOCAL_ENV: Record<string, string> = {
  SITE_URL: 'http://localhost:3000',
  MOYASAR_API_BASE_URL: 'http://host.docker.internal:54390/v1',
  MOYASAR_SECRET_KEY: SECRET_KEY,
  MOYASAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
  PAYMENTS_MODE: 'test',
  FUNCTIONS_PUBLIC_URL: 'http://127.0.0.1:54321/functions/v1',
}
const PAYMENT_NAMES = ['MOYASAR_API_BASE_URL', 'MOYASAR_SECRET_KEY', 'MOYASAR_WEBHOOK_SECRET', 'PAYMENTS_MODE', 'FUNCTIONS_PUBLIC_URL', 'PAYMENTS_TEST_ACCESS_CODE']

function setEnv(values: Record<string, string>): void {
  for (const name of PAYMENT_NAMES) vi.stubEnv(name, '')
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value)
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

const client = {
  createInvoice: vi.fn(),
  fetchInvoice: vi.fn(),
  listInvoices: vi.fn(),
  cancelInvoice: vi.fn(),
  fetchPayment: vi.fn(),
  refundPayment: vi.fn(),
}
const providerCalls = (): number => Object.values(client).reduce((sum, fn) => sum + fn.mock.calls.length, 0)
const payments = (over: Partial<PaymentDeps> = {}): PaymentDeps => ({ rpc, client: client as unknown as MoyasarClient, config, ...over })
const good = <T>(data: T): MoyasarResult<T> => ({ ok: true, status: 200, data })
const unavailable: MoyasarResult<never> = { ok: false, kind: 'unavailable' }

const invoiceOf = (over: Partial<MoyasarInvoice> = {}): MoyasarInvoice => ({
  id: INVOICE_ID,
  status: 'initiated',
  amount: TOTAL,
  currency: 'SAR',
  url: `http://127.0.0.1:54390/invoices/${INVOICE_ID}`,
  expiredAt: '2026-10-02T12:20:00.000Z',
  metadata: {},
  payments: [],
  ...over,
})

const memoryStore = (): MediaStore => ({
  signedUpload: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
})
const staffAs = (role: StaffIdentity['role'] | 'none', recentTotp = false) => async (): Promise<StaffIdentity | null> =>
  role === 'none' ? null : { userId: USER, role, recentTotp }

const post = (body: unknown): Request =>
  new Request('http://127.0.0.1:54321/functions/v1/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer staff-token' },
    body: JSON.stringify(body),
  })
const recheck = (role: StaffIdentity['role'] | 'none', body: unknown = { action: 'payment-recheck', attemptId: ATTEMPT }, over: Partial<PaymentDeps> | null = {}) =>
  handleAdmin(post(body), { rpc, staff: staffAs(role), store: memoryStore(), ...(over === null ? {} : { payments: payments(over) }) })

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString()
const ref = (over: Record<string, unknown> = {}) => ({
  ok: true,
  attemptId: ATTEMPT,
  status: 'pending',
  providerInvoiceId: INVOICE_ID,
  providerPaymentId: null,
  orderNumber: 'ABCD2345',
  createdAt: ago(600_000),
  amount: TOTAL,
  currency: 'SAR',
  ...over,
})

beforeEach(() => {
  calls.length = 0
  script.clear()
  for (const fn of Object.values(client)) fn.mockReset().mockResolvedValue(unavailable)
  reply('payment_attempt_created', { ok: true })
  reply('payment_attempt_close', { ok: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ---- payment-recheck ----------------------------------------------------------------------------------------

describe('payment-recheck: who may', () => {
  it('only an owner, with no TOTP step-up; nobody else reaches the database or the provider', async () => {
    reply('payment_attempt_ref', ref())
    for (const role of ['editor', 'operations', null] as const) {
      const response = await recheck(role)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    }
    expect((await recheck('none')).status).toBe(401)
    expect(calls).toHaveLength(0)
    expect(providerCalls()).toBe(0)
    // An owner whose last TOTP is old still succeeds: the recheck is a read of the provider, not a money action.
    client.fetchInvoice.mockResolvedValue(good(invoiceOf()))
    expect((await recheck('owner')).status).toBe(200)
  })

  it('refuses a body that does not carry an attempt id with 422, before anything is called', async () => {
    for (const body of [
      { action: 'payment-recheck' },
      { action: 'payment-recheck', attemptId: 5 },
      { action: 'payment-recheck', attemptId: 'not-a-uuid' },
      { action: 'payment-recheck', attemptId: ATTEMPT.toUpperCase() },
      { action: 'payment-recheck', attemptId: `${ATTEMPT}; drop table x` },
    ]) {
      const response = await recheck('owner', body)
      expect(response.status, JSON.stringify(body)).toBe(422)
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID' } })
    }
    expect(calls).toHaveLength(0)
  })

  it('answers 503 PAYMENTS_NOT_CONFIGURED while payments are not configured, and touches nothing', async () => {
    setEnv({})
    const response = await recheck('owner', undefined, null)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'PAYMENTS_NOT_CONFIGURED' } })
    expect(calls).toHaveLength(0)
  })
})

describe('payment-recheck: what it does', () => {
  it('asks the SQL for the attempt as this owner and the configured mode, and 404s an attempt it does not know', async () => {
    reply('payment_attempt_ref', { ok: false, code: 'NOT_FOUND' })
    const response = await recheck('owner', undefined, { config: { ...config, mode: 'test' } })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(calls).toEqual([{ fn: 'payment_attempt_ref', args: { p_actor: USER, p_attempt: ATTEMPT, p_mode: 'test' } }])
    expect(providerCalls()).toBe(0)
  })

  it('a pending attempt is settled from what the provider holds, and the answer is its new status', async () => {
    reply('payment_attempt_ref', ref(), ref({ status: 'paid', providerPaymentId: PAYMENT_ID }))
    reply('apply_verified_payment', { outcome: 'paid', orderNumber: 'ABCD2345' })
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid', payments: [{ id: PAYMENT_ID, status: 'paid' }] })))
    client.fetchPayment.mockResolvedValue(
      good({ id: PAYMENT_ID, status: 'paid', amount: TOTAL, currency: 'SAR', fee: 0, refunded: 0, invoiceId: INVOICE_ID, createdAt: null, sourceType: 'creditcard', sourceCompany: 'mada' }),
    )
    const response = await recheck('owner')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: { status: 'paid' } })
    expect(names()).toEqual(['payment_attempt_ref', 'apply_verified_payment', 'payment_attempt_ref'])
    expect(client.fetchInvoice).toHaveBeenCalledWith(INVOICE_ID)
    expect(client.fetchPayment).toHaveBeenCalledWith(PAYMENT_ID)
    expect(called('apply_verified_payment')[0]!.args).toMatchObject({ p_invoice_id: INVOICE_ID, p_mode: 'test', p_live: null, p_event_id: null })
  })

  it('an attempt that is still unpaid records the check as a prompt and answers its unchanged status', async () => {
    reply('payment_attempt_ref', ref())
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'initiated' })))
    const response = await recheck('owner')
    expect(await response.json()).toEqual({ ok: true, data: { status: 'pending' } })
    expect(called('payment_attempt_checked')).toEqual([
      { fn: 'payment_attempt_checked', args: { p_attempt: ATTEMPT, p_source: 'prompt', p_ok: true, p_provider_status: 'initiated', p_error: null } },
    ])
  })

  it('a provider that cannot be reached is a failed check and the status is unchanged, never "not paid"', async () => {
    reply('payment_attempt_ref', ref())
    const response = await recheck('owner')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: { status: 'pending' } })
    expect(called('payment_attempt_checked')[0]!.args).toMatchObject({ p_ok: false, p_source: 'prompt', p_error: 'INVOICE_FETCH_UNAVAILABLE' })
    expect(called('apply_verified_payment')).toHaveLength(0)
  })

  it('a closed attempt with an invoice (a late payment may still arrive) is settled the same way', async () => {
    reply('payment_attempt_ref', ref({ status: 'expired' }))
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'expired' })))
    expect(await (await recheck('owner')).json()).toEqual({ ok: true, data: { status: 'expired' } })
    expect(client.fetchInvoice).toHaveBeenCalledTimes(1)
  })

  it('an attempt with no invoice that is not uncertain has nothing to ask the provider', async () => {
    reply('payment_attempt_ref', ref({ status: 'creating', providerInvoiceId: null }))
    expect(await (await recheck('owner')).json()).toEqual({ ok: true, data: { status: 'creating' } })
    expect(providerCalls()).toBe(0)
    expect(names()).toEqual(['payment_attempt_ref', 'payment_attempt_ref'])
  })

  it('an uncertain attempt is adopted when the provider holds its invoice, and never begins a new one', async () => {
    const match = invoiceOf({ id: randomUUID(), metadata: { order_number: 'ABCD2345', attempt_id: ATTEMPT } })
    reply('payment_attempt_ref', ref({ status: 'uncertain', providerInvoiceId: null }), ref({ providerInvoiceId: match.id }))
    client.listInvoices.mockResolvedValue(good({ invoices: [match], nextPage: null }))
    const response = await recheck('owner')
    expect(await response.json()).toEqual({ ok: true, data: { status: 'pending' } })
    expect(client.listInvoices).toHaveBeenCalledWith({ metadata: { attempt_id: ATTEMPT }, page: 1 })
    expect(called('payment_attempt_created')[0]!.args).toMatchObject({ p_attempt: ATTEMPT, p_invoice_id: match.id })
    expect(called('payment_attempt_begin')).toHaveLength(0)
    expect(client.createInvoice).not.toHaveBeenCalled()
  })

  it('an uncertain attempt whose creation never landed is abandoned (once it is old enough)', async () => {
    reply('payment_attempt_ref', ref({ status: 'uncertain', providerInvoiceId: null }), ref({ status: 'abandoned', providerInvoiceId: null }))
    client.listInvoices.mockResolvedValue(good({ invoices: [], nextPage: null }))
    expect(await (await recheck('owner')).json()).toEqual({ ok: true, data: { status: 'abandoned' } })
    expect(called('payment_attempt_close')[0]!.args).toEqual({ p_attempt: ATTEMPT, p_status: 'abandoned', p_error: 'CREATE_ABSENT' })
    expect(called('payment_attempt_begin')).toHaveLength(0)
  })

  it('a young uncertain attempt stays uncertain: the creation may still land', async () => {
    reply('payment_attempt_ref', ref({ status: 'uncertain', providerInvoiceId: null, createdAt: ago(5_000) }))
    client.listInvoices.mockResolvedValue(good({ invoices: [], nextPage: null }))
    expect(await (await recheck('owner')).json()).toEqual({ ok: true, data: { status: 'uncertain' } })
    expect(called('payment_attempt_close')).toHaveLength(0)
  })

  it('an uncertain attempt whose list fails stays uncertain, with no provider writes', async () => {
    reply('payment_attempt_ref', ref({ status: 'uncertain', providerInvoiceId: null }))
    expect(await (await recheck('owner')).json()).toEqual({ ok: true, data: { status: 'uncertain' } })
    expect(called('payment_attempt_close')).toHaveLength(0)
    expect(called('payment_attempt_created')).toHaveLength(0)
  })

  it('uses the configured mode: a live site asks for live attempts', async () => {
    reply('payment_attempt_ref', { ok: false, code: 'NOT_FOUND' })
    await recheck('owner', undefined, { config: { ...config, mode: 'live' } })
    expect(called('payment_attempt_ref')[0]!.args.p_mode).toBe('live')
  })

  it('a database refusal is mapped, never leaked: a revoked owner is 403, anything else a detail-free 500', async () => {
    reply('payment_attempt_ref', Object.assign(new Error('Owner only.'), { code: '42501' }))
    expect((await recheck('owner')).status).toBe(403)
    reply('payment_attempt_ref', Object.assign(new Error('connection to server at 10.0.0.5 lost'), { code: '08006' }))
    const broken = await recheck('owner')
    expect(broken.status).toBe(500)
    const text = JSON.stringify(await broken.json())
    expect(text).not.toContain('10.0.0.5')
    expect(text).toContain('FAILED')
  })

  it('answers the status alone: no provider id, no payment id, no amount', async () => {
    reply('payment_attempt_ref', ref({ status: 'paid', providerPaymentId: PAYMENT_ID }))
    client.fetchInvoice.mockResolvedValue(good(invoiceOf({ status: 'paid' })))
    const text = await (await recheck('owner')).text()
    expect(JSON.parse(text)).toEqual({ ok: true, data: { status: 'paid' } })
    for (const secret of [INVOICE_ID, PAYMENT_ID, SECRET_KEY, WEBHOOK_SECRET]) expect(text).not.toContain(secret)
  })

  it('builds its payment dependencies from the environment when none are injected: the admin\'s own rpc, the configured base and key', async () => {
    setEnv(LOCAL_ENV)
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ ...invoiceOf(), expired_at: null, payments: [] }))
    vi.stubGlobal('fetch', fetchStub)
    reply('payment_attempt_ref', ref())
    const response = await recheck('owner', undefined, null)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: { status: 'pending' } })
    expect(String(fetchStub.mock.calls[0]![0])).toBe(`http://host.docker.internal:54390/v1/invoices/${INVOICE_ID}`)
    expect((fetchStub.mock.calls[0]![1]!.headers as Record<string, string>).authorization).toMatch(/^Basic /)
    expect(called('payment_attempt_ref')[0]!.args).toMatchObject({ p_actor: USER, p_mode: 'test' })
  })
})

// ---- status -------------------------------------------------------------------------------------------------

describe('status: payments', () => {
  const status = async (role: StaffIdentity['role'] = 'owner') => {
    const response = await handleAdmin(post({ action: 'status' }), { rpc, staff: staffAs(role), store: memoryStore() })
    return { response, text: await response.text() }
  }
  const paymentsOf = (text: string) => (JSON.parse(text) as { data: { payments: unknown } }).data.payments

  it('is for the owner only, like the rest of status', async () => {
    expect((await status('editor')).response.status).toBe(403)
    expect((await status('operations')).response.status).toBe(403)
  })

  it('the local emulator: configured, in test mode, on an emulator; booleans and the mode only', async () => {
    setEnv(LOCAL_ENV)
    const { response, text } = await status()
    expect(response.status).toBe(200)
    expect(paymentsOf(text)).toEqual({ configured: true, mode: 'test', emulator: true })
    for (const secret of [SECRET_KEY, WEBHOOK_SECRET, 'host.docker.internal', '54390', 'sk_']) expect(text).not.toContain(secret)
  })

  it('nothing set: not configured, with the reason code, and no mode', async () => {
    setEnv({})
    const { text } = await status()
    expect(paymentsOf(text)).toEqual({ configured: false, reason: 'NOT_CONFIGURED', emulator: false })
  })

  it.each([
    ['a key that does not match the mode', { MOYASAR_SECRET_KEY: 'sk_live_not_the_test_key_value' }, 'KEY_MODE_MISMATCH'],
    ['a mode that is neither test nor live', { PAYMENTS_MODE: 'staging' }, 'BAD_MODE'],
    ['a weak webhook secret', { MOYASAR_WEBHOOK_SECRET: 'short' }, 'WEAK_WEBHOOK_SECRET'],
    ['live on a local site', { PAYMENTS_MODE: 'live', MOYASAR_SECRET_KEY: 'sk_live_local_key_value' }, 'LIVE_ON_LOCAL'],
    ['a base that is not the emulator or the provider', { MOYASAR_API_BASE_URL: 'https://example.com/v1' }, 'BAD_BASE_URL'],
  ])('%s: not configured, with the reason code and no mode', async (_label, over, reason) => {
    setEnv({ ...LOCAL_ENV, ...over })
    const { text } = await status()
    const shown = paymentsOf(text) as Record<string, unknown>
    expect(shown).toMatchObject({ configured: false, reason })
    expect(shown).not.toHaveProperty('mode')
    for (const secret of [SECRET_KEY, WEBHOOK_SECRET, 'sk_live_local_key_value', 'https://example.com']) expect(text).not.toContain(secret)
  })

  it('emulator reflects the API base host alone: a local host is true even when the rest is invalid, the real base is false', async () => {
    setEnv({ ...LOCAL_ENV, MOYASAR_SECRET_KEY: '' })
    expect(paymentsOf((await status()).text)).toEqual({ configured: false, reason: 'NOT_CONFIGURED', emulator: true })
    for (const base of ['http://localhost:54390/v1', 'http://127.0.0.1:54390/v1', 'http://[::1]:54390/v1']) {
      setEnv({ ...LOCAL_ENV, MOYASAR_API_BASE_URL: base })
      expect(paymentsOf((await status()).text), base).toMatchObject({ configured: true, emulator: true })
    }
    setEnv({ ...LOCAL_ENV, MOYASAR_API_BASE_URL: 'https://api.moyasar.com/v1', FUNCTIONS_PUBLIC_URL: 'https://tunnel.example.dev/functions/v1' })
    expect(paymentsOf((await status()).text)).toEqual({ configured: true, mode: 'test', emulator: false })
    setEnv({ ...LOCAL_ENV, MOYASAR_API_BASE_URL: 'not a url' })
    expect(paymentsOf((await status()).text)).toMatchObject({ configured: false, emulator: false })
  })

  it('a hosted site in test mode on the real base: configured, test, not an emulator', async () => {
    vi.stubEnv('SITE_URL', 'https://anas.studio')
    setEnv({
      MOYASAR_API_BASE_URL: 'https://api.moyasar.com/v1',
      MOYASAR_SECRET_KEY: 'sk_test_hosted_sandbox_key_value',
      MOYASAR_WEBHOOK_SECRET: 'hosted-webhook-secret-of-at-least-32-characters',
      PAYMENTS_MODE: 'test',
      FUNCTIONS_PUBLIC_URL: 'https://abcdefghijklmnop.supabase.co/functions/v1',
      PAYMENTS_TEST_ACCESS_CODE: 'sandbox-access-code-1234',
    })
    const { text } = await status()
    expect(paymentsOf(text)).toEqual({ configured: true, mode: 'test', emulator: false })
    for (const secret of ['sk_test_hosted', 'hosted-webhook-secret', 'sandbox-access-code', 'abcdefghijklmnop']) expect(text).not.toContain(secret)
  })

  it('keeps every other field of status', async () => {
    setEnv(LOCAL_ENV)
    vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA')
    const data = (JSON.parse((await status()).text) as { data: Record<string, unknown> }).data
    expect(data).toMatchObject({ turnstile: { configured: true, testSecret: true }, siteHost: 'localhost', payments: { configured: true } })
    expect(Object.keys(data).sort()).toEqual(['analytics', 'email', 'jobs', 'payments', 'siteHost', 'turnstile', 'webhook'])
  })
})

// ---- commerce-checkout-set ----------------------------------------------------------------------------------

describe('commerce-checkout-set', () => {
  const body = (over: Record<string, unknown> = {}) => ({ action: 'commerce-checkout-set', enabled: true, expectedVersion: 4, ...over })
  /** `payments: null` injects nothing, so the environment decides whether payments work. */
  const setSwitch = (role: StaffIdentity['role'] | 'none', request: unknown = body(), opts: { recentTotp?: boolean; payments?: PaymentDeps | null } = {}) =>
    handleAdmin(post(request), {
      rpc,
      staff: staffAs(role, opts.recentTotp ?? true),
      store: memoryStore(),
      ...(opts.payments === null ? {} : { payments: opts.payments ?? payments() }),
    })
  const answer = async (response: Response) => ({ status: response.status, body: await response.json() })

  it('only an owner with a fresh TOTP; nobody else reaches the database', async () => {
    for (const role of ['editor', 'operations'] as const) {
      const refused = await answer(await setSwitch(role))
      expect(refused.status).toBe(403)
      expect(refused.body).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    }
    expect((await setSwitch('none')).status).toBe(401)
    const stale = await answer(await setSwitch('owner', body(), { recentTotp: false }))
    expect(stale.status).toBe(403)
    expect(stale.body).toMatchObject({ ok: false, error: { code: 'STEP_UP_REQUIRED' } })
    expect(calls).toHaveLength(0)
    reply('commerce_checkout_set', 5)
    expect((await setSwitch('owner')).status).toBe(200)
  })

  it.each([
    ['no enabled', { enabled: undefined }],
    ['an enabled that is not a boolean', { enabled: 'yes' }],
    ['a negative version', { expectedVersion: -1 }],
    ['a fractional version', { expectedVersion: 1.5 }],
    ['a version that is not a number', { expectedVersion: '4' }],
    ['no version', { expectedVersion: undefined }],
    ['an unknown field', { settings: {} }],
  ])('refuses %s with 422 before anything is called', async (_label, over) => {
    const response = await answer(await setSwitch('owner', body(over)))
    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ ok: false, error: { code: 'INVALID' } })
    expect(calls).toHaveLength(0)
  })

  it('turns the switch on with the owner, the version it was read at and the flag, and answers the new version', async () => {
    reply('commerce_checkout_set', 5)
    const response = await answer(await setSwitch('owner'))
    expect(response).toEqual({ status: 200, body: { ok: true, data: { version: 5, checkoutEnabled: true } } })
    expect(calls).toEqual([{ fn: 'commerce_checkout_set', args: { p_actor: USER, p_expected_version: 4, p_enabled: true } }])
  })

  it('turns it off the same way', async () => {
    reply('commerce_checkout_set', 7)
    expect(await answer(await setSwitch('owner', body({ enabled: false, expectedVersion: 6 })))).toEqual({
      status: 200,
      body: { ok: true, data: { version: 7, checkoutEnabled: false } },
    })
    expect(called('commerce_checkout_set')[0]!.args).toEqual({ p_actor: USER, p_expected_version: 6, p_enabled: false })
  })

  it('enabling is refused 409 PAYMENTS_NOT_CONFIGURED while the payment settings do not work, and the database is not touched', async () => {
    setEnv({})
    const refused = await answer(await setSwitch('owner', body(), { payments: null }))
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ ok: false, error: { code: 'PAYMENTS_NOT_CONFIGURED', message: 'لم تُضبط إعدادات الدفع بعد.' } })
    // A configuration the rules refuse is the same: a live key on a local site.
    setEnv({ ...LOCAL_ENV, PAYMENTS_MODE: 'live', MOYASAR_SECRET_KEY: 'sk_live_local_key_value' })
    expect((await setSwitch('owner', body(), { payments: null })).status).toBe(409)
    expect(calls).toHaveLength(0)
  })

  it('turning it off needs no payment settings: an owner can always close the store', async () => {
    setEnv({})
    reply('commerce_checkout_set', 9)
    expect(await answer(await setSwitch('owner', body({ enabled: false }), { payments: null }))).toEqual({
      status: 200,
      body: { ok: true, data: { version: 9, checkoutEnabled: false } },
    })
  })

  it('reads the payment settings from the environment when none are injected', async () => {
    setEnv(LOCAL_ENV)
    reply('commerce_checkout_set', 5)
    expect((await setSwitch('owner', body(), { payments: null })).status).toBe(200)
    expect(called('commerce_checkout_set')).toHaveLength(1)
  })

  it('a stale version is 409 CONFLICT', async () => {
    reply('commerce_checkout_set', Object.assign(new Error('Commerce settings changed in another session.'), { code: '23505' }))
    const response = await answer(await setSwitch('owner'))
    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: 'تغيّرت الإعدادات من جلسة أخرى. أعد تحميل الصفحة.' } })
  })

  it('a seller or policies not ready is 422 NOT_READY', async () => {
    reply('commerce_checkout_set', Object.assign(new Error('Name the seller and approve the policies before opening checkout.'), { code: 'P0001' }))
    const response = await answer(await setSwitch('owner'))
    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ ok: false, error: { code: 'NOT_READY', message: 'أكمل بيانات البائع واعتمد السياسات أولًا.' } })
  })

  it('an owner revoked a moment ago is 403, and any other failure a detail-free 500', async () => {
    reply('commerce_checkout_set', Object.assign(new Error('Owner only.'), { code: '42501' }))
    expect((await setSwitch('owner')).status).toBe(403)
    reply('commerce_checkout_set', Object.assign(new Error('connection to server at 10.0.0.5 lost'), { code: '08006' }))
    const broken = await answer(await setSwitch('owner'))
    expect(broken.status).toBe(500)
    expect(JSON.stringify(broken.body)).not.toContain('10.0.0.5')
  })
})
